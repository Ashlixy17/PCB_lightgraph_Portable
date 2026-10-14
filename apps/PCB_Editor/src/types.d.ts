type ProcessingMode = 'gray' | 'color';
type ViewMode = 'overlay' | 'split' | 'quad';
type RegionTool = 'none' | 'select' | 'rect' | 'lasso' | 'brush' | 'wand';
type RegionOperation = 'new' | 'add' | 'subtract';
type PreviewKey = 'composite' | 'copper' | 'mask' | 'silk' | 'bottom';
type ProductionKey = 'Top_Copper' | 'Top_Mask' | 'Top_Silk' | 'Bottom_Mask';
type Span = [
    number,
    number,
    number
];
interface Point {
    x: number;
    y: number;
}
interface Size {
    w: number;
    h: number;
}
interface Rect extends Point, Size {
}
interface Bounds extends Point {
    endX: number;
    endY: number;
}
interface RGB {
    r: number;
    g: number;
    b: number;
}
interface LightStrip {
    start: Point;
    end: Point;
    radius: number;
    color: RGB;
}
interface GrayParams {
    silkThreshold: number;
    maskThreshold: number;
    thickRadius: number;
    blurRadius: number;
    previewMaskId: string;
}
interface ColorParams {
    finishType: string;
    maskColorName: string;
    isWhiteMask: boolean;
    goldThresh: number;
    silkThresh: number;
    transThresh: number;
    copperDepth: number;
    enableBare: boolean;
    bareGrayMode: boolean;
    bareGrayMin: number;
    bareGrayMax: number;
    bareSim: number;
    edgeMin: number;
    edgeMax: number;
}
interface ProcessedImages {
    copper: ImageData;
    mask: ImageData;
    silk: ImageData;
    bottom: ImageData;
    composite: ImageData;
}
type ProductionLayers = Record<'Top_Copper' | 'Top_Mask' | 'Top_Silk', ImageData> & {
    Bottom_Mask?: ImageData;
};
interface Camera {
    zoom: number;
    pan: Point;
}
interface PreviewState extends Camera {
    canvas: string;
    img: ImageData | null;
    srcCanvas: HTMLCanvasElement | null;
}
interface Region {
    id: number;
    name: string;
    spans: Span[];
    offsets: Record<ProcessingMode, Record<string, number>>;
}
interface RegionSnapshot {
    items: Region[];
    selected: number;
    globals: Record<string, number>;
}
interface OwnerCache {
    w: number;
    h: number;
    revision?: number;
    data: Uint32Array;
}
interface RegionGesture {
    tool: RegionTool;
    operation: RegionOperation;
    size: number;
    points: Point[];
    pointerId: number;
    previewRaster?: HTMLCanvasElement;
}
interface RegionPointer {
    canvas: HTMLCanvasElement;
    view: Camera;
    pointerId: number;
    x: number;
    y: number;
    point: Point | null;
    dragging: boolean;
    pan: Point;
}
interface RegionPress {
    pointerId: number;
    buttonMask: number;
    temporaryOperation: RegionOperation | null;
}
interface WandJob {
    origin: ImageData;
    revision: number;
    selected: number;
}
interface RegionChange {
    before: RegionSnapshot;
    target: number;
    spans: Span[];
    operation: RegionOperation;
}
interface RegionRaster extends Rect {
    canvas: HTMLCanvasElement;
    data: Uint8ClampedArray | null;
    scale: number;
}
interface LiveOverlay {
    gesture: RegionGesture;
    canvas: HTMLCanvasElement;
    active: Uint8Array;
    count: number;
    bounds: {
        x: number;
        y: number;
        right: number;
        bottom: number;
    } | null;
    signature: string | null;
}
interface RegionOverlayCache extends Point {
    selected: number;
    highlight: boolean;
    revision: number;
    canvas: HTMLCanvasElement;
    active: Uint8Array;
    live: LiveOverlay | null;
}
interface RegionState {
    items: Region[];
    selected: number;
    nextId: number;
    revision: number;
    maskRevision: number;
    tool: RegionTool;
    highlight: boolean;
    gesture: RegionGesture | null;
    pointer: RegionPointer | null;
    press: RegionPress | null;
    wandJob: WandJob | null;
    undo: RegionSnapshot[];
    redo: RegionSnapshot[];
    sliderBefore: RegionSnapshot | null;
    ownerCache: OwnerCache | null;
    previewOwnerCache: OwnerCache | null;
    overlayCache: RegionOverlayCache | null;
}
interface RegionRenderContext<T> {
    owners: Uint32Array;
    params: Map<number, T>;
    bounds: Map<number, Bounds>;
}
interface EditorState {
    origin: ImageData | null;
    originCanvas: HTMLCanvasElement | null;
    imageFileSize: number | null;
    processingMode: ProcessingMode;
    viewMode: ViewMode;
    gray: GrayParams;
    generation: number;
    fullResGeneration: number;
    layers: ProductionLayers | null;
    previewLayers: ProductionLayers | null;
    composite: ImageData | null;
    prefilter: {
        enabled: boolean;
        kernel: number;
        sigma: number;
    };
    dp: {
        enabled: boolean;
        tolerance: number;
        lineWidth: number;
    };
    light: {
        showOverlay: boolean;
        autoSense: number;
        radius: number;
        intensity: number;
        strips: LightStrip[];
        pendingStart: Point | null;
    };
    _roCache?: {
        w: number;
        h: number;
        src: ImageData;
        canvas?: HTMLCanvasElement;
        img: ImageData;
    } | null;
}
interface PaintStroke {
    tool?: string;
    action: string;
    pointerId?: number;
    mode?: string;
    size: number;
    points: Point[];
    color?: string;
}
interface PaintSession extends Camera {
    initialImage: ImageData;
    base: ImageData;
    sourceCanvas: HTMLCanvasElement;
    strokes: PaintStroke[];
    redo: PaintStroke[];
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    tool: string;
    brushMode: string;
    size: number;
    activeStroke: PaintStroke | null;
    panDrag: PanDrag | null;
    indicatorTimer: number;
    cleanup: (() => void) | null;
}
interface ExperimentalSettings {
    edgePrefilterEnabled?: boolean;
    edgePrefilterKernelSize?: number;
    edgePrefilterSigma?: number;
    dpEnabled?: boolean;
    dpTolerance?: number;
    dpLineWidth?: number;
}
type Controls = ReturnType<typeof gatherControls>;
type SavedControls = Omit<Partial<Controls>, "light" | "gray"> & {
    light?: Partial<Controls["light"]>;
    gray?: Partial<GrayParams>;
};
interface SerializedRegions {
    width: number;
    height: number;
    items: Region[];
}
interface ImportedProject {
    image: DecodedProjectImage;
    controls: SavedControls;
    experimental?: ExperimentalSettings;
    ledStrips?: LightStrip[];
    regions?: SerializedRegions;
}
interface DesktopLightStrip {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    radius: number;
    r: number;
    g: number;
    b: number;
}
type DesktopControls = Partial<ReturnType<typeof portableControlsToDesktop>>;
type FocusTarget = HTMLElement & {
    disabled?: boolean;
};
type GrayImages = Omit<ProcessedImages, 'bottom'>;
interface ReleaseInfo {
    tag_name: string;
    html_url?: string;
    body?: string;
}
interface ZipEntry {
    name: string;
    data: Uint8Array;
}
interface HTMLInputElement {
    _lastValue?: number;
}
interface PanDrag extends Point {
    pointerId: number;
    target: HTMLElement;
}
interface CropDrag {
    kind: string;
    startX: number;
    startY: number;
    rect: Rect;
}
interface DecodedProjectImage {
    origin: ImageData;
    canvas: HTMLCanvasElement;
    fileSize: number | null;
}
interface PackedZipEntry {
    nameBytes: Uint8Array;
    data: Uint8Array;
    compressed: Uint8Array;
    crc: number;
    localOffset?: number;
}
interface PreparedColorParams extends ColorParams {
    grayMinPct: number;
    grayMaxPct: number;
    simThresh: number;
    effCopper: number;
}
interface LightSample extends Point {
    color: RGB & {
        value: number;
    };
}
interface NativeProjectArgs {
    controls?: DesktopControls;
    imageFileName?: string;
    experimental?: ExperimentalSettings;
    ledStrips?: DesktopLightStrip[];
    portable?: Partial<Omit<ImportedProject, 'image'>>;
}
type LegacyProject = Partial<Omit<ImportedProject, 'image'>> & {
    image?: string;
};
interface LocalPreferences {
    custom?: Record<string, RGB>;
    prefilter?: EditorState['prefilter'];
    dp?: EditorState['dp'];
    edaImportProtection?: boolean;
}
