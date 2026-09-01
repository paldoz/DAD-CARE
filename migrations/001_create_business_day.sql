-- Migration: 001_create_business_day.sql
-- Purpose: Add BusinessDay table for Worked/Absence status without touching Maqal or accounting records

CREATE TABLE IF NOT EXISTS "BusinessDay" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "date" date NOT NULL UNIQUE,
    "status" text NOT NULL DEFAULT 'WORKED', -- 'WORKED' or 'ABSENCE'
    "reason" text,
    "created_by" text,
    "created_at" timestamp(3) NOT NULL DEFAULT current_timestamp,
    "updated_at" timestamp(3) NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS "idx_business_day_date" ON "BusinessDay"("date");
