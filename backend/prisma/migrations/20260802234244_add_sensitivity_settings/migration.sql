-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "enabledEntityTypes" TEXT[] DEFAULT ARRAY['name', 'id_number', 'case_number', 'amount', 'email', 'phone']::TEXT[];
