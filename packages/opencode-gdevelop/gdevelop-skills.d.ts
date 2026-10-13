/**
 * GDevelop 5 Skills & Dynamic Knowledge Engineering Type Definitions.
 *
 * Grounded in GDevelop Core (C++ AST) & GDJS Runtime bindings (Emscripten).
 * Zero synthetic types.
 */

// ============================================================================
// 1. Event Sheet Codegen Interfaces
// ============================================================================

export type InstructionType =
  | string
  | {
      value: string;
      inverted?: boolean;
      await?: boolean;
    };

export interface InstructionAST {
  type: InstructionType;
  inverted?: boolean;
  await?: boolean;
  parameters: string[];
  subInstructions?: InstructionAST[];
}

export type EventTypeString =
  | 'BuiltinCommonInstructions::Standard'
  | 'BuiltinCommonInstructions::While'
  | 'BuiltinCommonInstructions::Repeat'
  | 'BuiltinCommonInstructions::ForEach'
  | 'BuiltinCommonInstructions::ForEachChildVariable'
  | 'BuiltinCommonInstructions::JsCode'
  | 'BuiltinCommonInstructions::Comment'
  | 'BuiltinCommonInstructions::Group'
  | 'BuiltinCommonInstructions::Link';

export interface BaseEventAST {
  type: EventTypeString;
  disabled?: boolean;
  folded?: boolean;
}

export interface StandardEventAST extends BaseEventAST {
  type: 'BuiltinCommonInstructions::Standard';
  conditions: InstructionAST[];
  actions: InstructionAST[];
  events?: GDevelopEventAST[];
  variables?: VariableAST[];
}

export interface WhileEventAST extends BaseEventAST {
  type: 'BuiltinCommonInstructions::While';
  whileConditions: InstructionAST[];
  conditions: InstructionAST[];
  actions: InstructionAST[];
  events?: GDevelopEventAST[];
  loopIndexVariableName?: string;
}

export interface RepeatEventAST extends BaseEventAST {
  type: 'BuiltinCommonInstructions::Repeat';
  repeatExpression: string;
  conditions: InstructionAST[];
  actions: InstructionAST[];
  events?: GDevelopEventAST[];
  loopIndexVariableName?: string;
}

export interface ForEachEventAST extends BaseEventAST {
  type: 'BuiltinCommonInstructions::ForEach';
  object: string;
  conditions: InstructionAST[];
  actions: InstructionAST[];
  events?: GDevelopEventAST[];
  orderBy?: string;
  order?: 'asc' | 'desc';
  limit?: string;
  loopIndexVariableName?: string;
}

export interface ForEachChildVariableEventAST extends BaseEventAST {
  type: 'BuiltinCommonInstructions::ForEachChildVariable';
  iterableVariableName: string;
  valueIteratorVariableName?: string;
  keyIteratorVariableName?: string;
  loopIndexVariableName?: string;
  conditions: InstructionAST[];
  actions: InstructionAST[];
  events?: GDevelopEventAST[];
}

export interface JsCodeEventAST extends BaseEventAST {
  type: 'BuiltinCommonInstructions::JsCode';
  inlineCode: string;
  parameterObjects: string;
  useStrict?: boolean;
  eventsSheetExpanded?: boolean;
}

export interface CommentEventAST extends BaseEventAST {
  type: 'BuiltinCommonInstructions::Comment';
  comment: string;
  color?: { r: number; g: number; b: number };
}

export interface GroupEventAST extends BaseEventAST {
  type: 'BuiltinCommonInstructions::Group';
  name: string;
  events: GDevelopEventAST[];
}

export interface LinkEventAST extends BaseEventAST {
  type: 'BuiltinCommonInstructions::Link';
  target: string;
}

export type GDevelopEventAST =
  | StandardEventAST
  | WhileEventAST
  | RepeatEventAST
  | ForEachEventAST
  | ForEachChildVariableEventAST
  | JsCodeEventAST
  | CommentEventAST
  | GroupEventAST
  | LinkEventAST;

export interface VariableAST {
  name: string;
  type?: 'number' | 'string' | 'boolean' | 'structure' | 'array';
  value?: string | number | boolean;
  children?: VariableAST[];
}

// ============================================================================
// 2. Extension Wrapper Interfaces
// ============================================================================

export type FunctionTypeEnum =
  | 'Action'
  | 'Condition'
  | 'Expression'
  | 'StringExpression'
  | 'ExpressionAndCondition'
  | 'ActionWithOperator';

export type ParameterTypeEnum =
  | 'object'
  | 'behavior'
  | 'expression'
  | 'string'
  | 'boolean'
  | 'currentScene'
  | 'layer'
  | 'color'
  | 'key'
  | 'file';

export interface FunctionParameterAST {
  name: string;
  type: ParameterTypeEnum;
  description?: string;
  longDescription?: string;
  optional?: boolean;
  defaultValue?: string;
}

export interface EventsFunctionAST {
  name: string;
  fullName?: string;
  description?: string;
  sentence?: string;
  group?: string;
  functionType: FunctionTypeEnum;
  expressionType?: 'number' | 'string' | 'boolean';
  getterName?: string;
  isPrivate?: boolean;
  isAsync?: boolean;
  parameters: FunctionParameterAST[];
  events?: GDevelopEventAST[];
  useJsCode?: boolean;
  jsCode?: string;
}

export interface PropertyDescriptorAST {
  name: string;
  type: 'String' | 'Number' | 'Boolean' | 'Choice' | 'Color' | 'Behavior';
  label?: string;
  description?: string;
  value?: string | number | boolean;
  choices?: string[];
  hidden?: boolean;
  group?: string;
}

export interface EventsBasedBehaviorAST {
  name: string;
  fullName?: string;
  description?: string;
  objectType?: string;
  isPrivate?: boolean;
  properties: PropertyDescriptorAST[];
  sharedProperties?: PropertyDescriptorAST[];
  eventsFunctions: EventsFunctionAST[];
}

export interface EventsBasedObjectAST {
  name: string;
  fullName?: string;
  description?: string;
  defaultName?: string;
  isRenderedIn3D?: boolean;
  isAnimatable?: boolean;
  isTextContainer?: boolean;
  area?: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  };
  objects: any[];
  layers: LayerAST[];
  initialInstances: InitialInstanceAST[];
  properties: PropertyDescriptorAST[];
  eventsFunctions: EventsFunctionAST[];
}

export interface EventsFunctionsExtensionAST {
  name: string;
  fullName?: string;
  shortDescription?: string;
  description?: string;
  author?: string;
  version?: string;
  category?: string;
  tags?: string[];
  helpPath?: string;
  previewIconUrl?: string;
  iconUrl?: string;
  eventsFunctions: EventsFunctionAST[];
  eventsBasedBehaviors: EventsBasedBehaviorAST[];
  eventsBasedObjects: EventsBasedObjectAST[];
  dependencies?: Array<{
    name: string;
    type: string;
    exportName?: string;
    version?: string;
  }>;
  globalVariables?: VariableAST[];
  sceneVariables?: VariableAST[];
}

// ============================================================================
// 3. Scene Graph Interfaces
// ============================================================================

export interface CameraAST {
  defaultSize?: boolean;
  defaultViewport?: boolean;
  width?: number;
  height?: number;
  viewportX1?: number;
  viewportY1?: number;
  viewportX2?: number;
  viewportY2?: number;
}

export interface LayerEffectAST {
  name: string;
  effectType: string;
  doubleParameters?: Record<string, number>;
  stringParameters?: Record<string, string>;
  booleanParameters?: Record<string, boolean>;
}

export interface LayerAST {
  name: string;
  visibility?: boolean;
  isLocked?: boolean;
  renderingType?: '2d' | '3d';
  isLightingLayer?: boolean;
  followBaseLayerCamera?: boolean;
  camera3DNearPlaneDistance?: number;
  camera3DFarPlaneDistance?: number;
  camera3DFieldOfView?: number;
  camera2DPlaneMaxDrawingDistance?: number;
  cameras?: CameraAST[];
  effects?: LayerEffectAST[];
}

export interface InitialInstanceAST {
  name: string;
  x: number;
  y: number;
  z?: number;
  angle?: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  layer?: string;
  zOrder?: number;
  customSize?: boolean;
  width?: number;
  height?: number;
  depth?: number;
  locked?: boolean;
  sealed?: boolean;
  variables?: VariableAST[];
  initialProperties?: Record<string, string>;
}

// ============================================================================
// 4. Asset Injection Interfaces
// ============================================================================

export type ResourceKindEnum =
  | 'image'
  | 'audio'
  | 'font'
  | 'video'
  | 'json'
  | 'tilemap'
  | 'tileset'
  | 'bitmapFont'
  | 'model3D'
  | 'atlas'
  | 'spine'
  | 'javascript';

export interface ResourceDescriptorAST {
  name: string;
  kind: ResourceKindEnum;
  file: string;
  userAdded?: boolean;
  metadata?: string;
  origin?: {
    originName: string;
    originIdentifier: string;
  };
}

export interface SpritePointAST {
  name: string;
  x: number;
  y: number;
}

export interface SpriteFrameAST {
  image: string;
  hasCustomCollisionMask?: boolean;
  customCollisionMask?: Array<Array<{ x: number; y: number }>>;
  points?: SpritePointAST[];
}

export interface SpriteDirectionAST {
  timeBetweenFrames: number;
  looping: boolean;
  sprites: SpriteFrameAST[];
}

export interface SpriteAnimationAST {
  name: string;
  useMultipleDirections?: boolean;
  directions: SpriteDirectionAST[];
}

// ============================================================================
// 5. Dynamic Context Hydration Interfaces
// ============================================================================

export interface HydrationContextQuery {
  intent: 'eventsheet' | 'extension' | 'scenegraph' | 'asset' | 'audit';
  symbols?: string[];
  files?: string[];
  projectPath?: string;
}

export interface HydrationResult {
  indexedSymbols: Array<{
    name: string;
    qualifiedName: string;
    file: string;
    lineRange: [number, number];
  }>;
  relevantSchemas: string[];
  upstreamContextSnippets: string[];
  downstreamPatchAffordances: string[];
}
