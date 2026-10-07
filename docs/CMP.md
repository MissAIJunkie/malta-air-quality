# Consent management (CMP) — enabling it, and what it touches

**Written:** 2026-10-07 · Status: **not yet enabled.** Verified absent from the
live site on that date (no Funding Choices, `__tcfapi`, `googlefc`, Cookiebot,
OneTrust or Iubenda in the served HTML).

Companion to `docs/DEPLOYMENT.md`. This covers the consent banner only — the
AdSense account, ad units and the "Low value content" remediation are elsewhere.

---

## 1. Why this is needed

Publishers serving ads to users in the **EEA, the UK and Switzerland** must use a
consent management platform that is **certified by Google** and integrates with
the IAB's Transparency and Consent Framework (TCF). Switzerland has been in
scope since 31 July 2024.

Malta is in the EEA. Essentially all of this site's audience is therefore in
scope, which makes the practical consequence blunt: **without a CMP, approval
alone does not produce revenue.** Ads either do not serve or serve
non-personalised to the entire audience.

### What it is NOT needed for

It is **not** a requirement for the AdSense site review. maqua.app was refused
with "Low value content", and a consent banner has no bearing on that verdict.
Enabling the CMP does not move the review along; it removes a dependency that
would otherwise bite on the day approval arrives.

So the ordering is: fix the content verdict, get approved, and have the CMP
already in place rather than discovering it afterwards.

---

## 2. The recommended route: Google's own CMP

Free, certified, and — the part that matters for this repository — **requires no
code change at all.**

> "For most cases, you don't need to re-tag at all — your existing Google
> Publisher Tag or AdSense tag deploys user messages once the message is
> published in the relevant product."

The AdSense loader is already on every page of this site. It is a plain
`<script>` in the root layout (`src/app/layout.tsx`, the `ADSENSE_CLIENT`
constant), and it was verified live in the `<head>` of every route on
2026-10-07. That tag is the delivery mechanism for the consent message, so
publishing a message in the console is the whole implementation.

The one exception that _does_ need its own tag is the **ad blocking recovery**
message. That is a different product and is not in scope here.

### Steps

1. Sign in to AdSense → **Privacy & messaging** in the sidebar.
2. Click **Manage** on the **European regulations** message card. You may be
   prompted to confirm account settings on the _Settings_ tab first.
3. Choose the languages to serve. 30+ European languages are supported; Maltese
   and English are the ones that matter here, and the site itself declares
   `en`, `mt` and `fr` in `src/lib/i18n/dictionary.ts`.
4. Choose the button layout:
   - **two-button** — _Consent_ / _Manage options_
   - **three-button** — adds _Do not consent_

   **Prefer three-button.** It lets a visitor refuse in a single click, which is
   the safer reading of EU consent rules and is consistent with how the rest of
   this site behaves — see `docs/AI_USAGE.md` and `/privacy`, neither of which
   relies on a reader failing to find the decline path.

5. Review the **ad technology providers** (ATPs) on the European regulations
   settings page.
6. **Publish** the message.

### Then test it immediately

```
https://maqua.app/?fc=alwaysshow&fctype=gdpr
```

That parameter forces the message to display regardless of normal targeting. It
is also how to answer a question the published documentation does not settle:
**whether the consent message serves while the site is still unapproved for
ads.** One request resolves it empirically rather than by inference.

Open devtools before loading it. See §4.

---

## 3. If a third-party CMP is preferred instead

Any Google-certified, TCF-integrated CMP is acceptable — Cookiebot,
consentmanager, Cookie Information, Iubenda, Osano and others. The trade-off is
real work where Google's option is none:

- a script has to be added to the site, which means a new third party in the
  root layout;
- its hosts have to be allowed in the CSP (`src/proxy.ts`) across whichever
  directives it actually uses;
- `/privacy` has to declare it as a third party, in the section that currently
  lists Vercel, the base map tile service, Neon, Resend, Upstash, OpenRouter,
  Google AdSense, and ERA/EEA;
- it becomes something to keep certified as Google's requirements change.

Worth it only if consent UI that is fully under this project's control is
wanted. Otherwise Google's CMP is the smaller surface.

---

## 4. The CSP interaction — the one thing likely to go wrong

This repository's Content-Security-Policy is generated **per request** in
`src/proxy.ts`, not in `next.config.ts`. The full reasoning is in that file's
header comment; the short version is that Google documents strict, nonce-based
CSP as the _only_ supported arrangement for AdSense, because its ad hosts change
over time and a host allowlist goes stale silently.

**Scripts will be fine.** `script-src` carries a per-request nonce plus
`'strict-dynamic'`, so anything the AdSense loader injects — including the
consent dialog's own code — inherits trust automatically. That is the mechanism
Google relies on.

**Styling and fonts are the exposure.** "Follows Google's guidance" is true of
`script-src` and nothing else. Google's published example sets no `default-src`
at all, which leaves several directives unrestricted in their policy and
restricted in ours:

| Directive     | This site                | Google's example | Risk                                                                             |
| ------------- | ------------------------ | ---------------- | -------------------------------------------------------------------------------- |
| `style-src`   | `'self' 'unsafe-inline'` | unrestricted     | an **external** stylesheet from a Google host is blocked; inline styles are fine |
| `font-src`    | `'self' data:`           | unrestricted     | an external webfont is blocked                                                   |
| `media-src`   | `'none'`                 | unrestricted     | audio/video in a message would be blocked                                        |
| `img-src`     | includes `https:`        | unrestricted     | covered                                                                          |
| `frame-src`   | `https:`                 | unrestricted     | covered                                                                          |
| `connect-src` | includes `https:`        | unrestricted     | covered                                                                          |

This matters because a **consent dialog renders in the top-level document**, not
inside the ad iframe, so these directives govern it. The failure mode is quiet:
an unstyled or fontless banner rather than a visible error.

It is **deliberately not pre-widened.** Guessing which hosts a CMP will want,
for a CMP not yet chosen, loosens the policy today against a benefit that may
never arrive.

### What to do

Load the test URL in §2 with the browser console open. A CSP violation names
both the directive and the blocked URL, so the fix is mechanical:

1. Note the directive and host from the console message.
2. Add that host to that directive in `contentSecurityPolicy()` in
   `src/proxy.ts`, beside the existing entries and with a comment saying what
   needs it.
3. Rebuild and reload the test URL; confirm the console is clean and the banner
   is styled.

Do not widen a directive the console has not named.

---

## 5. What else changes on the day this goes live

### `/privacy` — two edits, both currently false or missing

1. **A sentence that becomes untrue.** `src/app/privacy/page.tsx` carries, under
   the advertising section:

   > "A consent tool for visitors in the EEA and the UK is being put in place.
   > Until it is, you can turn off personalised advertising in Google's own Ads
   > Settings, or block third-party cookies in your browser."

   True while nothing is in place. False the moment a banner appears, and it is
   the kind of claim that should not outlive its accuracy by a single deploy.
   Replace it with how to **change or withdraw** consent, since a TCF CMP
   exposes a way to reopen the dialog.

2. **Inbound email is still undocumented.** Unrelated to the CMP but outstanding
   in the same file. `/contact` publishes `hello@maqua.app` and deliberately
   makes no claim about retention or purpose, because the mail provider and
   retention period are the owner's decisions rather than something the code can
   assert. `/privacy` needs a short paragraph once those are decided.

### Possibly `/privacy`'s third-party list

Only if a **third-party** CMP is chosen (§3). Google's own CMP is served by the
AdSense tag that `/privacy` already declares, so it introduces no new third
party.

---

## 6. Checklist

- [ ] Google CMP published in AdSense → Privacy & messaging → European
      regulations, three-button layout
- [ ] ATP selection reviewed
- [ ] `?fc=alwaysshow&fctype=gdpr` loaded with devtools open; banner appears
- [ ] Browser console clean, or the named directive widened in `src/proxy.ts`
- [ ] Banner is styled and has its fonts (the quiet failure in §4)
- [ ] Consent recorded and respected across a reload
- [ ] `/privacy` consent sentence replaced with how to change consent
- [ ] Whether the message serves pre-approval recorded here, since the
      documentation does not say

---

## Sources

- [Google consent management requirements for serving ads in the EEA, the UK, and Switzerland](https://support.google.com/adsense/answer/13554116)
- [Set up and manage your consent management platform (CMP)](https://support.google.com/adsense/answer/7670013)
- [About Privacy & messaging](https://support.google.com/adsense/answer/10924669)
- [How the Google Consent Management Platform (CMP) works](https://support.google.com/adsense/answer/16918505)
- [Integrate the AdSense ad code with a Content Security Policy (CSP)](https://support.google.com/adsense/answer/16283098)

Retrieved 2026-10-07. Google's console UI and certification requirements both
change; re-check the first two links before following §2 if much time has
passed.
