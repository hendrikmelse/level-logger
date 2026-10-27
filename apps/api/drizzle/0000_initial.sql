CREATE TABLE "calibrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"adc1" double precision NOT NULL,
	"inches1" double precision NOT NULL,
	"adc2" double precision NOT NULL,
	"inches2" double precision NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calibrations_deviceId_effectiveFrom_unique" UNIQUE("device_id","effective_from")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_apiKeyHash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"device_id" integer NOT NULL,
	"ts" timestamp (3) with time zone NOT NULL,
	"adc" integer NOT NULL,
	CONSTRAINT "readings_device_id_ts_pk" PRIMARY KEY("device_id","ts")
);
--> statement-breakpoint
CREATE TABLE "readings_minute" (
	"device_id" integer NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"n" integer NOT NULL,
	"sum_adc" bigint NOT NULL,
	"min_adc" integer NOT NULL,
	"max_adc" integer NOT NULL,
	CONSTRAINT "readings_minute_device_id_bucket_pk" PRIMARY KEY("device_id","bucket")
);
--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings_minute" ADD CONSTRAINT "readings_minute_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;