import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarClock, Mail, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONTACT, IMAGES } from "@/lib/site";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Tell us what's eating your time and we'll tell you straight whether we can help. We reply to every message.",
};

/** PUBLIC page — no auth. Protection lives in the server action. */
export default function ContactPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(50%_60%_at_50%_0%,var(--accent)_0%,transparent_70%)] opacity-60"
        />
        <div className="mx-auto w-full max-w-3xl px-6 py-16 text-center sm:py-20">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Let&apos;s talk about your business.
          </h1>
          <p className="mt-5 text-lg text-pretty text-muted-foreground">
            Tell us what the work looks like and what&apos;s eating your time.
            If we can help, we&apos;ll say how. If we can&apos;t, we&apos;ll say
            that too.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto w-full max-w-6xl px-6 py-16">
          <div className="grid gap-10 lg:grid-cols-5 lg:gap-12">
            <div className="lg:col-span-3">
              <ContactForm />
            </div>

            <aside className="space-y-6 lg:col-span-2">
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <h2 className="font-medium">Reach us directly</h2>
                <ul className="mt-4 space-y-4 text-sm">
                  <li className="flex gap-3">
                    <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <a
                      href={`mailto:${CONTACT.email}`}
                      className="break-all transition-colors hover:text-foreground"
                    >
                      {CONTACT.email}
                    </a>
                  </li>
                  {CONTACT.phone && (
                    <li className="flex gap-3">
                      <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <a
                        href={`tel:${CONTACT.phone.href}`}
                        className="transition-colors hover:text-foreground"
                      >
                        {CONTACT.phone.display}
                      </a>
                    </li>
                  )}
                  {CONTACT.location && (
                    <li className="flex gap-3">
                      <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {CONTACT.location}
                      </span>
                    </li>
                  )}
                  <li className="flex gap-3">
                    <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {CONTACT.responseTime}
                    </span>
                  </li>
                </ul>

                {CONTACT.bookingUrl && (
                  <Button
                    asChild
                    variant="outline"
                    className="mt-6 h-10 w-full px-5"
                  >
                    <a
                      href={CONTACT.bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Book a call
                    </a>
                  </Button>
                )}
              </div>

              <div className="rounded-xl border bg-muted/40 p-6">
                <h2 className="font-medium text-pretty">
                  Not sure what to ask for yet?
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Take the free health check first. Ten questions, and you get a
                  written picture of where your time and money are going —
                  whether or not you ever talk to us.
                </p>
                <Button asChild variant="outline" className="mt-5 h-10 px-5">
                  <Link href="/health-check">
                    Start the health check <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>

              {/* Decorative. Swap public/marketing/contact-aside.png for a real
                  photo — see public/marketing/README.md. */}
              <div className="hidden overflow-hidden rounded-xl border lg:block">
                <Image
                  src={IMAGES.contactAside.src}
                  alt={IMAGES.contactAside.alt}
                  width={IMAGES.contactAside.width}
                  height={IMAGES.contactAside.height}
                  sizes="(max-width: 1024px) 0px, 420px"
                  className="h-auto w-full"
                />
              </div>
            </aside>
          </div>
        </div>
      </section>
    </>
  );
}
