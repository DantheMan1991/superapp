/**
 * A personal tool's accent, the same way a business module gets its own
 * (`src/app/dashboard/m/layout.tsx`): it reads the slug from the third path
 * segment, which is where `/personal/m/<slug>` puts it too, so the component
 * is reused as it is rather than copied.
 */
export { default } from "@/app/dashboard/m/layout";
