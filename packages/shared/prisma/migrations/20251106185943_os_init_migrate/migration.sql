-- AlterTable
ALTER TABLE "datasets" ALTER COLUMN "expected_output_schema" SET DATA TYPE JSONB,
ALTER COLUMN "input_schema" SET DATA TYPE JSONB;
