import DOMPurify from "dompurify";

const trustedResourcePath = /^\/(?:resources|user-skills\/assets)\/[^\s"'<>]+$/u;
const unsafeStyleProperties = [
  "background-image",
  "behavior",
  "bottom",
  "clip-path",
  "filter",
  "inset",
  "left",
  "position",
  "right",
  "top",
  "transform",
  "z-index"
] as const;

function sanitizeInlineStyles(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    unsafeStyleProperties.forEach((property) => element.style.removeProperty(property));

    for (const property of Array.from(element.style)) {
      const value = element.style.getPropertyValue(property);
      if (/url\s*\(|expression\s*\(|@import/iu.test(value)) {
        element.style.removeProperty(property);
      }
    }

    if (!element.getAttribute("style")?.trim()) element.removeAttribute("style");
  });
}

function resolvePreviewResources(
  root: ParentNode,
  resolveResourceUrl: (path: string) => string
): void {
  root.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
    const source = image.getAttribute("src")?.trim() ?? "";
    if (!trustedResourcePath.test(source)) {
      image.remove();
      return;
    }

    image.setAttribute("src", resolveResourceUrl(source));
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
  });
}

export function createArtifactPreviewFragment(
  html: string,
  resolveResourceUrl: (path: string) => string,
  ownerDocument: Document = document
): DocumentFragment {
  const sanitized = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["audio", "button", "embed", "form", "iframe", "input", "object", "script", "style", "video"],
    FORBID_ATTR: ["formaction", "srcdoc"],
    RETURN_DOM_FRAGMENT: true
  });
  const fragment = ownerDocument.createDocumentFragment();
  fragment.append(...Array.from(sanitized.childNodes).map((node) => ownerDocument.importNode(node, true)));

  sanitizeInlineStyles(fragment);
  resolvePreviewResources(fragment, resolveResourceUrl);
  return fragment;
}
