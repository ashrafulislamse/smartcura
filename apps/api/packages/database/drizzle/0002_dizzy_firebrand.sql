CREATE TABLE "foundation_transaction_probes" (
	"probe_id" uuid PRIMARY KEY NOT NULL,
	"marker" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
