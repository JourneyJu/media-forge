// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createArtifactPreviewFragment } from "./artifact-preview";

function renderPreview(html: string): HTMLDivElement {
  const host = document.createElement("div");
  host.append(createArtifactPreviewFragment(
    html,
    (path) => `https://service.local${path}?access_token=test`,
    document
  ));
  return host;
}

describe("createArtifactPreviewFragment", () => {
  it("removes executable elements, event handlers, and dangerous URLs", () => {
    const preview = renderPreview(`
      <section onclick="alert(1)">
        <script>alert(1)</script>
        <a href="javascript:alert(1)">危险链接</a>
        <p>安全正文</p>
      </section>
    `);

    expect(preview.querySelector("script")).toBeNull();
    expect(preview.querySelector("section")?.hasAttribute("onclick")).toBe(false);
    expect(preview.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(preview.textContent).toContain("安全正文");
  });

  it("resolves only trusted local image resources through DOM attributes", () => {
    const preview = renderPreview(`
      <p>/resources/in-body/content 不应被替换</p>
      <img id="resource" src="/resources/resource_1/content" alt="资源图">
      <img id="skill" src="/user-skills/assets/asset_1/content" alt="Skill 图">
      <img id="remote" src="https://example.com/tracker.png" alt="远程图">
    `);

    expect(preview.querySelector<HTMLImageElement>("#resource")?.src)
      .toBe("https://service.local/resources/resource_1/content?access_token=test");
    expect(preview.querySelector<HTMLImageElement>("#skill")?.src)
      .toBe("https://service.local/user-skills/assets/asset_1/content?access_token=test");
    expect(preview.querySelector("#remote")).toBeNull();
    expect(preview.querySelector("p")?.textContent).toContain("/resources/in-body/content");
  });

  it("keeps renderer inline styles while removing styles that can escape the preview", () => {
    const preview = renderPreview(`
      <section style="color:#173f37;position:fixed;inset:0;background-image:url(https://example.com/a.png);z-index:9999">
        <p style="font-size:16px;line-height:2">正文</p>
      </section>
    `);

    const sectionStyle = preview.querySelector<HTMLElement>("section")?.style;
    expect(sectionStyle?.color).toBe("rgb(23, 63, 55)");
    expect(sectionStyle?.position).toBe("");
    expect(sectionStyle?.inset).toBe("");
    expect(sectionStyle?.backgroundImage).toBe("");
    expect(sectionStyle?.zIndex).toBe("");
    expect(preview.querySelector<HTMLElement>("p")?.style.fontSize).toBe("16px");
  });

  it("returns an empty fragment when no allowed article content remains", () => {
    const fragment = createArtifactPreviewFragment(
      "<script>alert(1)</script><iframe src='https://example.com'></iframe>",
      (path) => path,
      document
    );

    expect(fragment.childNodes).toHaveLength(0);
  });
});
