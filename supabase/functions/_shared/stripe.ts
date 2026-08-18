import Stripe from "npm:stripe@22.3.2";
import { ApiError } from "./http.ts";

export type ExpectedWorkshopPrice = {
  priceId: string;
  productId: string;
  amountCents: number;
  currency: "EUR";
};

export async function validateWorkshopPrice(
  stripe: Stripe,
  expected: ExpectedWorkshopPrice,
): Promise<Stripe.Price> {
  const price = await stripe.prices.retrieve(expected.priceId, { expand: ["product"] });
  const productId = typeof price.product === "string" ? price.product : price.product.id;
  const productActive = typeof price.product === "string"
    ? false
    : !("deleted" in price.product && price.product.deleted) &&
      "active" in price.product && price.product.active;

  if (
    !price.active ||
    !productActive ||
    price.type !== "one_time" ||
    price.currency.toUpperCase() !== expected.currency ||
    price.unit_amount !== expected.amountCents ||
    price.tax_behavior !== "inclusive" ||
    productId !== expected.productId
  ) {
    throw new ApiError(
      "stripe_price_mismatch",
      "The workshop payment configuration does not match its published price.",
      409,
    );
  }

  return price;
}
