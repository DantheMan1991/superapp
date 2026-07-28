import Image from "next/image";
import Link from "next/link";
import { CONTACT, SITE } from "@/lib/site";

const PRODUCT_LINKS = [
  { href: "/health-check", label: "Free business health check" },
  { href: "/sign-up", label: "Get started" },
  { href: "/sign-in", label: "Sign in" },
];

const COMPANY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <Image
                src="/yosher-mark.png"
                alt=""
                width={32}
                height={32}
                className="rounded-md"
              />
              <span className="font-semibold tracking-tight">{SITE.name}</span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              {SITE.category}. Software runs the day-to-day so you can stay on
              the work only you can do.
            </p>
          </div>

          <div>
            <h2 className="text-xs font-semibold tracking-wide text-foreground uppercase">
              Product
            </h2>
            <ul className="mt-3 space-y-2.5">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-semibold tracking-wide text-foreground uppercase">
              Company
            </h2>
            <ul className="mt-3 space-y-2.5">
              {COMPANY_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={`mailto:${CONTACT.email}`}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {CONTACT.email}
                </a>
              </li>
              {CONTACT.phone && (
                <li>
                  <a
                    href={`tel:${CONTACT.phone.href}`}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {CONTACT.phone.display}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} {SITE.name}. {SITE.tagline}
          </span>
          {CONTACT.location && <span>{CONTACT.location}</span>}
        </div>
      </div>
    </footer>
  );
}
