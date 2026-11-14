import { redirect } from "next/navigation";

interface StocktakeAliasProps {
  params: Promise<{ slug: string }>;
}

/**
 * Convenience Alias Route for Stocktake Workflow (/slug/stocktake -> /slug/inventory/stocktake)
 */
export default async function StocktakeAliasPage({ params }: StocktakeAliasProps) {
  const { slug } = await params;
  redirect(`/${slug}/inventory/stocktake`);
}
