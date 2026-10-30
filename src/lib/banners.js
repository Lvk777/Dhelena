export function primaryBannerCta(banner) {
    return { href: banner.button_link ?? banner.primary_cta_link ?? '', label: banner.button_text ?? banner.primary_cta_label ?? '' };
}
