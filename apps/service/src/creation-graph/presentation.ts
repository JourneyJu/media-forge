import {
  presentationStyleDecisionSchema,
  userPresentationConstraintsSchema,
  type CreationGraphState,
  type PresentationStyleDecision,
  type UserPresentationConstraints
} from "@mediaforge/contracts";

const COLOR_TOKEN_PATTERN = /#[0-9a-fA-F]{6}\b|米白色?|暖白色?|墨绿色?|深蓝色?|蓝灰色?|玫红色?|金色|银色|红色|橙色|黄色|绿色|青色|蓝色|紫色|粉色|黑色|白色|灰色/gu;
const NEGATIVE_PATTERN = /不要|避免|禁用|禁止|不使用|不能用|去掉/gu;
const COLOR_USAGE_PATTERN = /标题|副标题|正文|背景|底色|点缀|强调|按钮|边框|分隔|用于|使用/gu;
const DECORATION_PATTERN = /装饰|留白|卡片|边框|分隔|标签|编号|圆角|阴影|纹理|极简|克制|丰富/gu;
const IMAGE_PATTERN = /首图|封面图|章节图|章节图片|配图|图片|大图|小图|画廊|裁切|图注|图框/gu;
const BRAND_PATTERN = /品牌|Logo|logo|LOGO|二维码|CTA|行动号召|咨询|报名|购买|关注/gu;

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function fragments(input: string): string[] {
  return input
    .split(/[。；;！？!?\n]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function colorTokens(fragment: string): string[] {
  return unique(fragment.match(COLOR_TOKEN_PATTERN) ?? []);
}

export function extractUserPresentationConstraints(
  userInput: string
): UserPresentationConstraints {
  const relevantFragments: string[] = [];
  const requestedColors: string[] = [];
  const prohibitedColors: string[] = [];
  const colorUsage: string[] = [];
  const decorationRequirements: string[] = [];
  const imageRequirements: string[] = [];
  const brandRequirements: string[] = [];

  for (const fragment of fragments(userInput)) {
    const colors = colorTokens(fragment);
    const isDecoration = DECORATION_PATTERN.test(fragment);
    DECORATION_PATTERN.lastIndex = 0;
    const isImage = IMAGE_PATTERN.test(fragment);
    IMAGE_PATTERN.lastIndex = 0;
    const isBrand = BRAND_PATTERN.test(fragment);
    BRAND_PATTERN.lastIndex = 0;
    const hasColorUsage = colors.length > 0 && COLOR_USAGE_PATTERN.test(fragment);
    COLOR_USAGE_PATTERN.lastIndex = 0;

    if (colors.length > 0) {
      for (const clause of fragment.split(/[，,]+/u)) {
        const clauseColors = colorTokens(clause);
        const isNegative = NEGATIVE_PATTERN.test(clause);
        NEGATIVE_PATTERN.lastIndex = 0;
        (isNegative ? prohibitedColors : requestedColors).push(...clauseColors);
      }
    }
    if (hasColorUsage) colorUsage.push(fragment);
    if (isDecoration) decorationRequirements.push(fragment);
    if (isImage) imageRequirements.push(fragment);
    if (isBrand) brandRequirements.push(fragment);
    if (colors.length > 0 || isDecoration || isImage || isBrand) {
      relevantFragments.push(fragment);
    }
  }

  return userPresentationConstraintsSchema.parse({
    rawFragments: unique(relevantFragments),
    requestedColors: unique(requestedColors),
    prohibitedColors: unique(prohibitedColors),
    colorUsage: unique(colorUsage),
    decorationRequirements: unique(decorationRequirements),
    imageRequirements: unique(imageRequirements),
    brandRequirements: unique(brandRequirements)
  });
}

interface DeterministicPresentationInput {
  structureVersion: string;
  subject: string;
  goal: "brand" | "promotion" | "event" | "education" | "story";
  tone: string;
  narrative: string;
  callToAction: string;
  imageCount: number;
  constraints: UserPresentationConstraints;
  selectedSkills: CreationGraphState["selectedSkills"];
}

function inferTheme(input: DeterministicPresentationInput): PresentationStyleDecision["visual"]["theme"] {
  const content = `${input.subject} ${input.tone} ${input.narrative}`;
  if (/报告|复盘|数据|研究|分析|专业/u.test(content)) return "professional-report";
  if (/获奖|庆祝|荣誉|舞台|盛典/u.test(content)) return "stage-celebration";
  if (/教程|指南|方法|步骤|攻略|科普/u.test(content)) return "practical-guide";
  if (input.goal === "brand" || input.goal === "promotion") return "brand-campaign";
  if (input.goal === "story" || /温暖|成长|陪伴|故事/u.test(content)) return "warm-story";
  return "editorial";
}

function inferredPalette(theme: PresentationStyleDecision["visual"]["theme"]) {
  switch (theme) {
    case "professional-report":
      return { primary: "#24445C", accent: "#4C7A92", text: "#20252B", surface: "#F4F7F8" };
    case "stage-celebration":
      return { primary: "#8F2447", accent: "#C99A3D", text: "#2B2024", surface: "#FFF8F2" };
    case "warm-story":
      return { primary: "#8B5E4B", accent: "#D28A64", text: "#302824", surface: "#FFF9F3" };
    case "practical-guide":
      return { primary: "#246B5B", accent: "#E09B45", text: "#202A27", surface: "#F4F8F5" };
    case "brand-campaign":
      return { primary: "#2C4F7C", accent: "#E0714A", text: "#20242A", surface: "#F7F8FA" };
    default:
      return { primary: "#16745B", accent: "#E7654B", text: "#20252B", surface: "#F7F8F6" };
  }
}

export function createDeterministicPresentationDecision(
  input: DeterministicPresentationInput
): PresentationStyleDecision {
  const theme = inferTheme(input);
  const fallback = inferredPalette(theme);
  const skill = input.selectedSkills[0];
  const skillPrimary = skill?.manifest.style.primaryColor;
  const hasUserRequirements = input.constraints.rawFragments.length > 0;
  const hasSkill = Boolean(skill);
  const source = hasUserRequirements && hasSkill
    ? "mixed"
    : hasUserRequirements
      ? "user"
      : hasSkill
        ? "skill"
        : "content";
  const colorSource = input.constraints.requestedColors.length > 0
    ? (hasSkill ? "mixed" : "user")
    : skillPrimary
      ? "skill"
      : "content";
  const primary = input.constraints.requestedColors[0] ?? skillPrimary ?? fallback.primary;
  const accent = input.constraints.requestedColors[1] ?? fallback.accent;
  const minimalDecoration = input.constraints.decorationRequirements.some((requirement) =>
    /减少|克制|极简|不要.*装饰|去掉/u.test(requirement)
  );
  const noCrop = input.constraints.imageRequirements.some((requirement) => /不裁切|不要裁切|原比例/u.test(requirement));
  const largeHero = input.constraints.imageRequirements.some((requirement) => /首图.*大图|封面.*大图/u.test(requirement));
  const brandAssets = skill?.assets.map((asset) => asset.key) ?? [];
  const hasLogo = brandAssets.some((key) => /logo/u.test(key));
  const hasQrcode = brandAssets.some((key) => /qrcode|qr/u.test(key));

  return presentationStyleDecisionSchema.parse({
    schemaVersion: "presentation-style-v1",
    structureVersion: input.structureVersion,
    source,
    confidence: hasUserRequirements || hasSkill ? 0.92 : 0.78,
    evidence: hasUserRequirements
      ? `优先采用用户呈现要求：${input.constraints.rawFragments.join("；")}`
      : `根据主题“${input.subject}”、语气“${input.tone}”和内容叙事推断`,
    visual: {
      theme,
      hierarchy: input.imageCount >= 5 ? "image-led" : "balanced",
      typography: theme === "warm-story" ? "mixed" : "sans",
      density: theme === "professional-report" ? "compact" : "comfortable",
      alignment: theme === "stage-celebration" ? "mixed" : "left",
      whitespace: minimalDecoration ? "generous" : "balanced",
      sectionRhythm: theme === "professional-report"
        ? "numbered"
        : theme === "stage-celebration"
          ? "labelled"
          : "minimal"
    },
    colorDecoration: {
      colorSource,
      requestedColors: input.constraints.requestedColors,
      prohibitedColors: input.constraints.prohibitedColors,
      paletteIntent: {
        primary,
        accent,
        text: fallback.text,
        surface: fallback.surface
      },
      brightness: "light",
      saturation: theme === "stage-celebration" ? "medium" : "low",
      contrast: "high",
      surfaceTreatment: minimalDecoration ? "none" : "tinted",
      dividerTreatment: "whitespace",
      sectionMarker: theme === "professional-report" ? "number" : "none",
      ornamentLevel: minimalDecoration ? "minimal" : theme === "stage-celebration" ? "moderate" : "minimal"
    },
    imagePresentation: {
      heroStrategy: largeHero ? "full-width" : "after-title",
      sizeStrategy: input.imageCount >= 4 ? "narrative-role" : "full-width",
      aspectPolicy: noCrop ? "no-crop" : "preserve",
      grouping: input.imageCount >= 6 ? "text-image-alternating" : "single",
      frameTreatment: minimalDecoration ? "none" : "thin-border",
      captionPolicy: "short",
      rhythm: input.imageCount >= 4 ? "one-per-section" : "focus-sections"
    },
    brandPresentation: {
      prominence: hasSkill ? "standard" : "light",
      logoPlacement: hasLogo ? "ending" : "none",
      fixedModules: skill?.manifest.assets.filter((asset) => asset.required).map((asset) => asset.key) ?? [],
      brandAssets,
      ctaStyle: hasQrcode
        ? "consult"
        : input.goal === "promotion"
          ? "register"
          : input.callToAction
            ? "follow"
            : "none",
      qrcodePlacement: hasQrcode ? "cta" : "none",
      constraints: input.constraints.brandRequirements
    }
  });
}

export function enforceUserPresentationConstraints(
  decision: PresentationStyleDecision,
  constraints: UserPresentationConstraints
): PresentationStyleDecision {
  if (constraints.rawFragments.length === 0) {
    return presentationStyleDecisionSchema.parse(decision);
  }

  const primary = constraints.requestedColors[0]
    ?? decision.colorDecoration.paletteIntent.primary;
  const accent = constraints.requestedColors[1]
    ?? decision.colorDecoration.paletteIntent.accent;
  const minimalDecoration = constraints.decorationRequirements.some((requirement) =>
    /减少|克制|极简|不要.*装饰|去掉/u.test(requirement)
  );
  const noCrop = constraints.imageRequirements.some((requirement) =>
    /不裁切|不要裁切|原比例/u.test(requirement)
  );
  const largeHero = constraints.imageRequirements.some((requirement) =>
    /首图.*大图|封面.*大图/u.test(requirement)
  );
  const noRoundedFrame = constraints.imageRequirements.some((requirement) =>
    /不要圆角|不使用圆角/u.test(requirement)
  );

  return presentationStyleDecisionSchema.parse({
    ...decision,
    source: decision.source === "skill" || decision.source === "mixed" ? "mixed" : "user",
    evidence: `用户呈现要求已作为硬约束：${constraints.rawFragments.join("；")}`,
    visual: {
      ...decision.visual,
      ...(minimalDecoration ? { whitespace: "generous" as const } : {})
    },
    colorDecoration: {
      ...decision.colorDecoration,
      colorSource: decision.colorDecoration.colorSource === "skill"
        || decision.colorDecoration.colorSource === "mixed"
        ? "mixed"
        : "user",
      requestedColors: constraints.requestedColors,
      prohibitedColors: constraints.prohibitedColors,
      paletteIntent: {
        ...decision.colorDecoration.paletteIntent,
        primary,
        accent
      },
      ...(minimalDecoration
        ? {
            surfaceTreatment: "none" as const,
            dividerTreatment: "whitespace" as const,
            ornamentLevel: "minimal" as const
          }
        : {})
    },
    imagePresentation: {
      ...decision.imagePresentation,
      ...(largeHero ? { heroStrategy: "full-width" as const } : {}),
      ...(noCrop ? { aspectPolicy: "no-crop" as const } : {}),
      ...(noRoundedFrame && decision.imagePresentation.frameTreatment === "rounded"
        ? { frameTreatment: "thin-border" as const }
        : {})
    },
    brandPresentation: {
      ...decision.brandPresentation,
      constraints: unique([
        ...decision.brandPresentation.constraints,
        ...constraints.brandRequirements
      ])
    }
  });
}
