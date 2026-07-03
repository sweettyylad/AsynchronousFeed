-- CreateEnum
CREATE TYPE "SearchStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "search_results" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "status" "SearchStatus" NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "search_results_query_key" ON "search_results"("query");
