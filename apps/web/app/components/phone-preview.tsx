"use client";

import { useEffect, useRef, useState } from "react";
import { createArtifactPreviewFragment } from "../lib/artifact-preview";

const previewBaseStyles = `
  :host {
    display: block;
    width: 390px;
    min-height: 844px;
    color: #222;
    background: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .preview-root {
    box-sizing: border-box;
    width: 390px;
    min-height: 844px;
    margin: 0;
    overflow-wrap: anywhere;
    background: #fff;
  }
  .preview-root *,
  .preview-root *::before,
  .preview-root *::after {
    box-sizing: border-box;
  }
  .preview-root img {
    max-width: 100%;
    height: auto;
  }
  .preview-image-error {
    min-height: 120px;
    margin: 18px 0;
    padding: 24px 18px;
    display: grid;
    place-items: center;
    border: 1px dashed #d9c7bd;
    color: #8a6f63;
    background: #fff8f4;
    font-size: 13px;
    line-height: 1.7;
    text-align: center;
  }
`;

type PhonePreviewProps = {
  html: string;
  resolveResourceUrl: (path: string) => string;
};

export function PhonePreview({ html, resolveResourceUrl }: PhonePreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    try {
      const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      const fragment = createArtifactPreviewFragment(html, resolveResourceUrl, document);
      const previewRoot = document.createElement("div");
      previewRoot.className = "preview-root";
      previewRoot.append(fragment);
      previewRoot.querySelectorAll("img").forEach((image) => {
        image.addEventListener("error", () => {
          const fallback = document.createElement("div");
          fallback.className = "preview-image-error";
          fallback.textContent = image.alt ? `图片加载失败：${image.alt}` : "图片加载失败";
          image.replaceWith(fallback);
        }, { once: true });
      });

      if (!previewRoot.textContent?.trim() && !previewRoot.querySelector("img")) {
        throw new Error("预览内容为空");
      }

      const style = document.createElement("style");
      style.textContent = previewBaseStyles;
      shadowRoot.replaceChildren(style, previewRoot);
      setError("");
    } catch {
      host.shadowRoot?.replaceChildren();
      setError("文章预览暂时无法显示，请切换到源码查看或稍后重试复制。");
    }
  }, [html, resolveResourceUrl]);

  return (
    <div className="phone-preview-stage">
      <div className="phone-preview-scaler">
        <div className="phone" aria-label="公众号文章手机预览">
          {error ? <p className="phone-preview-error" role="alert">{error}</p> : null}
          <div ref={hostRef} className="phone-preview-surface" />
        </div>
      </div>
    </div>
  );
}
