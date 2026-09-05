import { ImageOff, RefreshCcw, ShoppingCart, Store } from "lucide-react";
import type { Offer, OfferCategory } from "../types";
import { displayDistance, type DistanceUnit } from "../services/distance";

const labels: Record<OfferCategory, string> = { order: "Order online", local: "Buy in store", secondHand: "Second hand" };
function Stars({ rating }: { rating: number }) { const full = Math.round(rating); return <span className="stars" aria-label={`${rating} out of 5 stars`}>{"★".repeat(full)}{"☆".repeat(Math.max(0, 5 - full))}</span>; }
function money(value: number, currency = "USD") { try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: currency === "ILS" ? 0 : 2 }).format(value); } catch { return `${value.toFixed(2)} ${currency}`; } }
function Price({ offer, category }: { offer: Offer; category: OfferCategory }) {
  if (offer.itemPrice === null) return <span className="unverified-price">Price unavailable</span>;
  return <div className="offer-price"><strong>{money(offer.totalPrice ?? offer.itemPrice, offer.currency)}</strong>{category !== "local" && <>
    {offer.totalEstimated && <small>Estimated total</small>}
    <small>Item: {money(offer.itemPrice, offer.currency)}</small>
    <small>{offer.shippingPrice === 0 ? "Free shipping" : offer.shippingPrice != null ? `${offer.shippingEstimated ? "Est. shipping" : "Shipping"}: ${money(offer.shippingPrice, offer.currency)}` : "Shipping: at checkout"}</small>
    {offer.importTaxPrice != null && <small>Import taxes{offer.taxesIncluded ? " (included)" : ""}: {money(offer.importTaxPrice, offer.currency)}</small>}
    {offer.importTaxUnknown && <small>Import taxes: at checkout</small>}
    {offer.taxPrice != null && <small>Taxes{offer.taxesIncluded ? " (included)" : ""}: {money(offer.taxPrice, offer.currency)}</small>}
    {!!offer.otherFeesPrice && <small>Other charges: {money(offer.otherFeesPrice, offer.currency)}</small>}
  </>}</div>;
}
export function OfferSection({ category, offers, distanceUnit }: { category: OfferCategory; offers: Offer[]; distanceUnit: DistanceUnit }) {
  if (!offers.length) return null; const Icon = category === "order" ? ShoppingCart : category === "local" ? Store : RefreshCcw;
  return <section className="offer-section" aria-labelledby={`category-${category}`}><h2 id={`category-${category}`}><Icon size={21} />{labels[category]} <span>({offers.length})</span></h2><div className="offer-table-heading" aria-hidden="true"><span>Offer</span><span>Retailer</span><span>Variant / Specs</span><span>Availability</span><span>Total price</span><span>Details</span></div><div className="offer-list">{offers.map((offer) => <article className="offer-row" key={offer.id}>{offer.imageUrl ? <img className="product-image" src={offer.imageUrl} alt="" loading="lazy" /> : <div className="product-image product-image--empty" aria-label="No product image available"><ImageOff size={22} /></div>}<div className="offer-merchant"><div className="merchant-identity">{offer.merchantLogoUrl && <img src={offer.merchantLogoUrl} alt="" />}<a href={offer.destinationUrl} target="_blank" rel="noreferrer">{offer.merchant}</a></div>{offer.reviewCount > 0 && <span><Stars rating={offer.rating} /> <small>({offer.reviewCount.toLocaleString()})</small></span>}</div><div className="offer-specs"><strong>{offer.title}</strong><span>{offer.subtitle}</span>{offer.condition && <small>{offer.condition}</small>}</div><div className="offer-availability"><strong>{offer.availability}</strong>{category === "local" && <span className="pickup-label">Local pickup</span>}{offer.arrival && <small>{offer.arrival}</small>}{offer.distanceMiles !== undefined && <small>{displayDistance(offer.distanceMiles, distanceUnit)}</small>}</div><Price offer={offer} category={category} /><a className="secondary-button offer-link" href={offer.destinationUrl} target="_blank" rel="noreferrer">{offer.linkLabel ?? "View product"}</a></article>)}</div></section>;
}
