const viewport = { width: 390, height: 844 } as const;
const device = { width: 410, height: 864 } as const;
const scale = 0.8;
const columns = {
  history: 260,
  collapsedHistory: 72,
  editorMinimum: 720,
  preview: 400,
  gap: 18,
  trailingPadding: 22
} as const;

export const phonePreviewLayout = {
  viewport,
  device,
  scale,
  stage: {
    width: device.width * scale,
    height: device.height * scale
  },
  columns,
  workbenchMinimum:
    columns.history + columns.editorMinimum + columns.preview + columns.gap * 2 + columns.trailingPadding,
  collapsedWorkbenchMinimum:
    columns.collapsedHistory + columns.editorMinimum + columns.preview + columns.gap * 2 + columns.trailingPadding
} as const;
