CREATE TABLE "ai_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"scope_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"body" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "ai_summaries_unique_input" UNIQUE("kind","scope_key","input_hash","locale")
);
--> statement-breakpoint
CREATE TABLE "air_quality_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" text NOT NULL,
	"pollutant" text NOT NULL,
	"valid_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"value" numeric(10, 3),
	"unit" text DEFAULT 'µg/m³' NOT NULL,
	"sub_index" numeric(4, 2),
	"category" text,
	"model" text DEFAULT 'CAMS' NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "air_quality_forecasts_unique_point" UNIQUE("station_id","pollutant","valid_at","issued_at","source")
);
--> statement-breakpoint
CREATE TABLE "air_quality_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" text NOT NULL,
	"pollutant" text NOT NULL,
	"value" numeric(10, 3),
	"unit" text DEFAULT 'µg/m³' NOT NULL,
	"sub_index" numeric(4, 2),
	"category" text,
	"averaging_period" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"modelled" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "air_quality_readings_unique_observation" UNIQUE("station_id","pollutant","measured_at","source")
);
--> statement-breakpoint
CREATE TABLE "air_quality_stations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"upstream_name" text,
	"locality" text NOT NULL,
	"island" text NOT NULL,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"altitude_metres" integer,
	"station_type" text NOT NULL,
	"area_classification" text NOT NULL,
	"expected_pollutants" jsonb NOT NULL,
	"operator" text NOT NULL,
	"source_url" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "air_quality_stations_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"signature" text NOT NULL,
	"station_id" text,
	"pollutant" text,
	"category" text,
	"measured_at" timestamp with time zone,
	"forecast" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "alert_deliveries_unique_signature" UNIQUE("subscription_id","signature")
);
--> statement-breakpoint
CREATE TABLE "alert_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_normalised" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"confirmation_token_hash" text,
	"confirmation_sent_at" timestamp with time zone,
	"confirmation_expires_at" timestamp with time zone,
	"unsubscribe_token_hash" text NOT NULL,
	"alert_types" jsonb NOT NULL,
	"pending_preferences" jsonb,
	"station_id" text,
	"pollutant" text,
	"threshold_category" text,
	"min_hours_between_alerts" integer DEFAULT 6 NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"last_alert_at" timestamp with time zone,
	"last_alert_signature" text,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_subscriptions_email_key" UNIQUE("email_normalised")
);
--> statement-breakpoint
CREATE TABLE "data_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"source" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"error" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "environmental_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_hash" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"relevance" text NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text NOT NULL,
	"published_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"affects_islands" jsonb,
	"related_pollutants" jsonb,
	"detail" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "environmental_events_dedupe_hash_key" UNIQUE("dedupe_hash")
);
--> statement-breakpoint
CREATE TABLE "provider_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"error" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "weather_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"temperature_c" numeric(5, 2),
	"relative_humidity_pct" numeric(5, 2),
	"wind_speed_ms" numeric(6, 2),
	"wind_direction_deg" numeric(5, 1),
	"pressure_hpa" numeric(7, 2),
	"precipitation_mm" numeric(6, 2),
	"boundary_layer_m" numeric(7, 1),
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weather_observations_unique_observation" UNIQUE("station_id","observed_at","source")
);
--> statement-breakpoint
ALTER TABLE "air_quality_forecasts" ADD CONSTRAINT "air_quality_forecasts_station_id_air_quality_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."air_quality_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "air_quality_readings" ADD CONSTRAINT "air_quality_readings_station_id_air_quality_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."air_quality_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_subscription_id_alert_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."alert_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_station_id_air_quality_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."air_quality_stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_observations" ADD CONSTRAINT "weather_observations_station_id_air_quality_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."air_quality_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_summaries_scope_idx" ON "ai_summaries" USING btree ("kind","scope_key","created_at");--> statement-breakpoint
CREATE INDEX "air_quality_forecasts_station_valid_idx" ON "air_quality_forecasts" USING btree ("station_id","valid_at");--> statement-breakpoint
CREATE INDEX "air_quality_readings_station_time_idx" ON "air_quality_readings" USING btree ("station_id","measured_at");--> statement-breakpoint
CREATE INDEX "air_quality_readings_measured_at_idx" ON "air_quality_readings" USING btree ("measured_at");--> statement-breakpoint
CREATE INDEX "air_quality_readings_pollutant_time_idx" ON "air_quality_readings" USING btree ("pollutant","measured_at");--> statement-breakpoint
CREATE INDEX "alert_deliveries_subscription_idx" ON "alert_deliveries" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE INDEX "alert_deliveries_status_idx" ON "alert_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "alert_subscriptions_due_idx" ON "alert_subscriptions" USING btree ("verified","paused","unsubscribed_at");--> statement-breakpoint
CREATE INDEX "alert_subscriptions_confirmation_idx" ON "alert_subscriptions" USING btree ("confirmation_token_hash");--> statement-breakpoint
CREATE INDEX "alert_subscriptions_unsubscribe_idx" ON "alert_subscriptions" USING btree ("unsubscribe_token_hash");--> statement-breakpoint
CREATE INDEX "data_import_runs_job_time_idx" ON "data_import_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "environmental_events_relevance_idx" ON "environmental_events" USING btree ("relevance","last_seen_at");--> statement-breakpoint
CREATE INDEX "environmental_events_last_seen_idx" ON "environmental_events" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "provider_health_provider_time_idx" ON "provider_health" USING btree ("provider","checked_at");--> statement-breakpoint
CREATE INDEX "weather_observations_station_time_idx" ON "weather_observations" USING btree ("station_id","observed_at");