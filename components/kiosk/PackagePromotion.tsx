import { CheckCircle2 } from "lucide-react";

type PackagePromotionProps = {
  name: string;
  description: string;
  price?: string | null;
  features: string;
};

export function PackagePromotion({
  name,
  description,
  price,
  features,
}: PackagePromotionProps) {
  const featureList = features.split(";").filter(Boolean);

  return (
    <article className="rounded-md border border-white/14 bg-white/8 p-5">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-xl font-semibold">{name}</h3>
        {price ? <span className="rounded-sm bg-amber px-3 py-1 text-sm font-semibold text-ink">{price}</span> : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-white/64">{description}</p>
      <ul className="mt-5 grid gap-2">
        {featureList.map((feature) => (
          <li key={feature} className="flex items-center gap-2 text-sm text-white/78">
            <CheckCircle2 className="h-4 w-4 text-mint" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
