CREATE TABLE "telegram_auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"session_ciphertext" text NOT NULL,
	"telegram_user_id" text,
	"display_name" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_auth_sessions" ADD CONSTRAINT "telegram_auth_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_auth_sessions_account_id_unique_index" ON "telegram_auth_sessions" USING btree ("account_id");