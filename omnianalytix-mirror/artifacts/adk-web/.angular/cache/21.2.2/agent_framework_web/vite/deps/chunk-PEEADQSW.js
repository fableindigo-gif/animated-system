import {
  __export,
  __spreadProps,
  __spreadValues
} from "./chunk-IZIF4DQH.js";

// node_modules/@a2ui/lit/src/0.8/events/events.js
var events_exports = {};
__export(events_exports, {
  StateEvent: () => StateEvent
});
var eventInit = {
  bubbles: true,
  cancelable: true,
  composed: true
};
var StateEvent = class _StateEvent extends CustomEvent {
  static {
    this.eventName = "a2uiaction";
  }
  constructor(payload) {
    super(_StateEvent.eventName, __spreadValues({ detail: payload }, eventInit));
    this.payload = payload;
  }
};

// node_modules/@a2ui/web_core/dist/src/v0_8/types/types.js
var types_exports = {};

// node_modules/@a2ui/web_core/dist/src/v0_8/data/guards.js
var guards_exports = {};
__export(guards_exports, {
  isComponentArrayReference: () => isComponentArrayReference,
  isObject: () => isObject,
  isPath: () => isPath,
  isResolvedAudioPlayer: () => isResolvedAudioPlayer,
  isResolvedButton: () => isResolvedButton,
  isResolvedCard: () => isResolvedCard,
  isResolvedCheckbox: () => isResolvedCheckbox,
  isResolvedColumn: () => isResolvedColumn,
  isResolvedDateTimeInput: () => isResolvedDateTimeInput,
  isResolvedDivider: () => isResolvedDivider,
  isResolvedIcon: () => isResolvedIcon,
  isResolvedImage: () => isResolvedImage,
  isResolvedList: () => isResolvedList,
  isResolvedModal: () => isResolvedModal,
  isResolvedMultipleChoice: () => isResolvedMultipleChoice,
  isResolvedRow: () => isResolvedRow,
  isResolvedSlider: () => isResolvedSlider,
  isResolvedTabs: () => isResolvedTabs,
  isResolvedText: () => isResolvedText,
  isResolvedTextField: () => isResolvedTextField,
  isResolvedVideo: () => isResolvedVideo,
  isValueMap: () => isValueMap
});
function isValueMap(value) {
  return isObject(value) && "key" in value;
}
function isPath(key, value) {
  return key === "path" && typeof value === "string";
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isComponentArrayReference(value) {
  if (!isObject(value))
    return false;
  return "explicitList" in value || "template" in value;
}
function isStringValue(value) {
  return isObject(value) && ("path" in value || "literal" in value && typeof value.literal === "string" || "literalString" in value);
}
function isNumberValue(value) {
  return isObject(value) && ("path" in value || "literal" in value && typeof value.literal === "number" || "literalNumber" in value);
}
function isBooleanValue(value) {
  return isObject(value) && ("path" in value || "literal" in value && typeof value.literal === "boolean" || "literalBoolean" in value);
}
function isAnyComponentNode(value) {
  if (!isObject(value))
    return false;
  const hasBaseKeys = "id" in value && "type" in value && "properties" in value;
  if (!hasBaseKeys)
    return false;
  return true;
}
function isResolvedAudioPlayer(props) {
  return isObject(props) && "url" in props && isStringValue(props.url);
}
function isResolvedButton(props) {
  return isObject(props) && "child" in props && isAnyComponentNode(props.child) && "action" in props;
}
function isResolvedCard(props) {
  if (!isObject(props))
    return false;
  if (!("child" in props)) {
    if (!("children" in props)) {
      return false;
    } else {
      return Array.isArray(props.children) && props.children.every(isAnyComponentNode);
    }
  }
  return isAnyComponentNode(props.child);
}
function isResolvedCheckbox(props) {
  return isObject(props) && "label" in props && isStringValue(props.label) && "value" in props && isBooleanValue(props.value);
}
function isResolvedColumn(props) {
  return isObject(props) && "children" in props && Array.isArray(props.children) && props.children.every(isAnyComponentNode);
}
function isResolvedDateTimeInput(props) {
  return isObject(props) && "value" in props && isStringValue(props.value);
}
function isResolvedDivider(props) {
  return isObject(props);
}
function isResolvedImage(props) {
  return isObject(props) && "url" in props && isStringValue(props.url);
}
function isResolvedIcon(props) {
  return isObject(props) && "name" in props && isStringValue(props.name);
}
function isResolvedList(props) {
  return isObject(props) && "children" in props && Array.isArray(props.children) && props.children.every(isAnyComponentNode);
}
function isResolvedModal(props) {
  return isObject(props) && "entryPointChild" in props && isAnyComponentNode(props.entryPointChild) && "contentChild" in props && isAnyComponentNode(props.contentChild);
}
function isResolvedMultipleChoice(props) {
  return isObject(props) && "selections" in props;
}
function isResolvedRow(props) {
  return isObject(props) && "children" in props && Array.isArray(props.children) && props.children.every(isAnyComponentNode);
}
function isResolvedSlider(props) {
  return isObject(props) && "value" in props && isNumberValue(props.value);
}
function isResolvedTabItem(item) {
  return isObject(item) && "title" in item && isStringValue(item.title) && "child" in item && isAnyComponentNode(item.child);
}
function isResolvedTabs(props) {
  return isObject(props) && "tabItems" in props && Array.isArray(props.tabItems) && props.tabItems.every(isResolvedTabItem);
}
function isResolvedText(props) {
  return isObject(props) && "text" in props && isStringValue(props.text);
}
function isResolvedTextField(props) {
  return isObject(props) && "label" in props && isStringValue(props.label);
}
function isResolvedVideo(props) {
  return isObject(props) && "url" in props && isStringValue(props.url);
}

// node_modules/@a2ui/web_core/dist/src/v0_8/data/model-processor.js
var A2uiMessageProcessor = class _A2uiMessageProcessor {
  static {
    this.DEFAULT_SURFACE_ID = "@default";
  }
  constructor(opts = { mapCtor: Map, arrayCtor: Array, setCtor: Set, objCtor: Object }) {
    this.opts = opts;
    this.mapCtor = Map;
    this.arrayCtor = Array;
    this.setCtor = Set;
    this.objCtor = Object;
    this.arrayCtor = opts.arrayCtor;
    this.mapCtor = opts.mapCtor;
    this.setCtor = opts.setCtor;
    this.objCtor = opts.objCtor;
    this.surfaces = new opts.mapCtor();
  }
  getSurfaces() {
    return this.surfaces;
  }
  clearSurfaces() {
    this.surfaces.clear();
  }
  processMessages(messages) {
    for (const message of messages) {
      if (message.beginRendering) {
        this.handleBeginRendering(message.beginRendering, message.beginRendering.surfaceId);
      }
      if (message.surfaceUpdate) {
        this.handleSurfaceUpdate(message.surfaceUpdate, message.surfaceUpdate.surfaceId);
      }
      if (message.dataModelUpdate) {
        this.handleDataModelUpdate(message.dataModelUpdate, message.dataModelUpdate.surfaceId);
      }
      if (message.deleteSurface) {
        this.handleDeleteSurface(message.deleteSurface);
      }
    }
  }
  /**
   * Retrieves the data for a given component node and a relative path string.
   * This correctly handles the special `.` path, which refers to the node's
   * own data context.
   */
  getData(node, relativePath, surfaceId = _A2uiMessageProcessor.DEFAULT_SURFACE_ID) {
    const surface = this.getOrCreateSurface(surfaceId);
    if (!surface)
      return null;
    let finalPath;
    if (relativePath === "." || relativePath === "") {
      finalPath = node.dataContextPath ?? "/";
    } else {
      finalPath = this.resolvePath(relativePath, node.dataContextPath);
    }
    return this.getDataByPath(surface.dataModel, finalPath);
  }
  setData(node, relativePath, value, surfaceId = _A2uiMessageProcessor.DEFAULT_SURFACE_ID) {
    if (!node) {
      console.warn("No component node set");
      return;
    }
    const surface = this.getOrCreateSurface(surfaceId);
    if (!surface)
      return;
    let finalPath;
    if (relativePath === "." || relativePath === "") {
      finalPath = node.dataContextPath ?? "/";
    } else {
      finalPath = this.resolvePath(relativePath, node.dataContextPath);
    }
    this.setDataByPath(surface.dataModel, finalPath, value);
  }
  resolvePath(path, dataContextPath) {
    if (path.startsWith("/")) {
      return path;
    }
    if (dataContextPath && dataContextPath !== "/") {
      return dataContextPath.endsWith("/") ? `${dataContextPath}${path}` : `${dataContextPath}/${path}`;
    }
    return `/${path}`;
  }
  parseIfJsonString(value) {
    if (typeof value !== "string") {
      return value;
    }
    const trimmedValue = value.trim();
    if (trimmedValue.startsWith("{") && trimmedValue.endsWith("}") || trimmedValue.startsWith("[") && trimmedValue.endsWith("]")) {
      try {
        return JSON.parse(value);
      } catch (e) {
        console.warn(`Failed to parse potential JSON string: "${value.substring(0, 50)}..."`, e);
        return value;
      }
    }
    return value;
  }
  /**
   * Converts a specific array format [{key: "...", value_string: "..."}, ...]
   * into a standard Map. It also attempts to parse any string values that
   * appear to be stringified JSON.
   */
  convertKeyValueArrayToMap(arr) {
    const map = new this.mapCtor();
    for (const item of arr) {
      if (!isObject(item) || !("key" in item))
        continue;
      const key = item.key;
      const valueKey = this.findValueKey(item);
      if (!valueKey)
        continue;
      let value = item[valueKey];
      if (valueKey === "valueMap" && Array.isArray(value)) {
        value = this.convertKeyValueArrayToMap(value);
      } else if (typeof value === "string") {
        value = this.parseIfJsonString(value);
      }
      this.setDataByPath(map, key, value);
    }
    return map;
  }
  setDataByPath(root, path, value) {
    if (Array.isArray(value) && (value.length === 0 || isObject(value[0]) && "key" in value[0])) {
      if (value.length === 1 && isObject(value[0]) && value[0].key === ".") {
        const item = value[0];
        const valueKey = this.findValueKey(item);
        if (valueKey) {
          value = item[valueKey];
          if (valueKey === "valueMap" && Array.isArray(value)) {
            value = this.convertKeyValueArrayToMap(value);
          } else if (typeof value === "string") {
            value = this.parseIfJsonString(value);
          }
        } else {
          value = this.convertKeyValueArrayToMap(value);
        }
      } else {
        value = this.convertKeyValueArrayToMap(value);
      }
    }
    const segments = this.normalizePath(path).split("/").filter((s) => s);
    if (segments.length === 0) {
      if (value instanceof Map || isObject(value)) {
        if (!(value instanceof Map) && isObject(value)) {
          value = new this.mapCtor(Object.entries(value));
        }
        root.clear();
        for (const [key, v] of value.entries()) {
          root.set(key, v);
        }
      } else {
        console.error("Cannot set root of DataModel to a non-Map value.");
      }
      return;
    }
    let current = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      let target;
      if (current instanceof Map) {
        target = current.get(segment);
      } else if (Array.isArray(current) && /^\d+$/.test(segment)) {
        target = current[parseInt(segment, 10)];
      }
      if (target === void 0 || typeof target !== "object" || target === null) {
        target = new this.mapCtor();
        if (current instanceof this.mapCtor) {
          current.set(segment, target);
        } else if (Array.isArray(current)) {
          current[parseInt(segment, 10)] = target;
        }
      }
      current = target;
    }
    const finalSegment = segments[segments.length - 1];
    const storedValue = value;
    if (current instanceof this.mapCtor) {
      current.set(finalSegment, storedValue);
    } else if (Array.isArray(current) && /^\d+$/.test(finalSegment)) {
      current[parseInt(finalSegment, 10)] = storedValue;
    }
  }
  /**
   * Normalizes a path string into a consistent, slash-delimited format.
   * Converts bracket notation and dot notation in a two-pass.
   * e.g., "bookRecommendations[0].title" -> "/bookRecommendations/0/title"
   * e.g., "book.0.title" -> "/book/0/title"
   */
  normalizePath(path) {
    const dotPath = path.replace(/\[(\d+)\]/g, ".$1");
    const segments = dotPath.split(".");
    return "/" + segments.filter((s) => s.length > 0).join("/");
  }
  getDataByPath(root, path) {
    const segments = this.normalizePath(path).split("/").filter((s) => s);
    let current = root;
    for (const segment of segments) {
      if (current === void 0 || current === null)
        return null;
      if (current instanceof Map) {
        current = current.get(segment);
      } else if (Array.isArray(current) && /^\d+$/.test(segment)) {
        current = current[parseInt(segment, 10)];
      } else if (isObject(current)) {
        current = current[segment];
      } else {
        return null;
      }
    }
    return current;
  }
  getOrCreateSurface(surfaceId) {
    let surface = this.surfaces.get(surfaceId);
    if (!surface) {
      surface = new this.objCtor({
        rootComponentId: null,
        componentTree: null,
        dataModel: new this.mapCtor(),
        components: new this.mapCtor(),
        styles: new this.objCtor()
      });
      this.surfaces.set(surfaceId, surface);
    }
    return surface;
  }
  handleBeginRendering(message, surfaceId) {
    const surface = this.getOrCreateSurface(surfaceId);
    surface.rootComponentId = message.root;
    surface.styles = message.styles ?? {};
    this.rebuildComponentTree(surface);
  }
  handleSurfaceUpdate(message, surfaceId) {
    const surface = this.getOrCreateSurface(surfaceId);
    for (const component of message.components) {
      surface.components.set(component.id, component);
    }
    this.rebuildComponentTree(surface);
  }
  handleDataModelUpdate(message, surfaceId) {
    const surface = this.getOrCreateSurface(surfaceId);
    const path = message.path ?? "/";
    this.setDataByPath(surface.dataModel, path, message.contents);
    this.rebuildComponentTree(surface);
  }
  handleDeleteSurface(message) {
    this.surfaces.delete(message.surfaceId);
  }
  /**
   * Starts at the root component of the surface and builds out the tree
   * recursively. This process involves resolving all properties of the child
   * components, and expanding on any explicit children lists or templates
   * found in the structure.
   *
   * @param surface The surface to be built.
   */
  rebuildComponentTree(surface) {
    if (!surface.rootComponentId) {
      surface.componentTree = null;
      return;
    }
    const visited = new this.setCtor();
    surface.componentTree = this.buildNodeRecursive(
      surface.rootComponentId,
      surface,
      visited,
      "/",
      ""
      // Initial idSuffix.
    );
  }
  /** Finds a value key in a map. */
  findValueKey(value) {
    return Object.keys(value).find((k) => k.startsWith("value"));
  }
  /**
   * Builds out the nodes recursively.
   */
  buildNodeRecursive(baseComponentId, surface, visited, dataContextPath, idSuffix = "") {
    const fullId = `${baseComponentId}${idSuffix}`;
    const { components } = surface;
    if (!components.has(baseComponentId)) {
      return null;
    }
    if (visited.has(fullId)) {
      throw new Error(`Circular dependency for component "${fullId}".`);
    }
    visited.add(fullId);
    const componentData = components.get(baseComponentId);
    const componentProps = componentData.component ?? {};
    const componentType = Object.keys(componentProps)[0];
    const unresolvedProperties = componentProps[componentType];
    const resolvedProperties = new this.objCtor();
    if (isObject(unresolvedProperties)) {
      for (const [key, value] of Object.entries(unresolvedProperties)) {
        resolvedProperties[key] = this.resolvePropertyValue(value, surface, visited, dataContextPath, idSuffix);
      }
    }
    visited.delete(fullId);
    const baseNode = {
      id: fullId,
      dataContextPath,
      weight: componentData.weight ?? "initial"
    };
    switch (componentType) {
      case "Text":
        if (!isResolvedText(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Text",
          properties: resolvedProperties
        }));
      case "Image":
        if (!isResolvedImage(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Image",
          properties: resolvedProperties
        }));
      case "Icon":
        if (!isResolvedIcon(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Icon",
          properties: resolvedProperties
        }));
      case "Video":
        if (!isResolvedVideo(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Video",
          properties: resolvedProperties
        }));
      case "AudioPlayer":
        if (!isResolvedAudioPlayer(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "AudioPlayer",
          properties: resolvedProperties
        }));
      case "Row":
        if (!isResolvedRow(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Row",
          properties: resolvedProperties
        }));
      case "Column":
        if (!isResolvedColumn(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Column",
          properties: resolvedProperties
        }));
      case "List":
        if (!isResolvedList(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "List",
          properties: resolvedProperties
        }));
      case "Card":
        if (!isResolvedCard(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Card",
          properties: resolvedProperties
        }));
      case "Tabs":
        if (!isResolvedTabs(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Tabs",
          properties: resolvedProperties
        }));
      case "Divider":
        if (!isResolvedDivider(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Divider",
          properties: resolvedProperties
        }));
      case "Modal":
        if (!isResolvedModal(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Modal",
          properties: resolvedProperties
        }));
      case "Button":
        if (!isResolvedButton(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Button",
          properties: resolvedProperties
        }));
      case "CheckBox":
        if (!isResolvedCheckbox(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "CheckBox",
          properties: resolvedProperties
        }));
      case "TextField":
        if (!isResolvedTextField(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "TextField",
          properties: resolvedProperties
        }));
      case "DateTimeInput":
        if (!isResolvedDateTimeInput(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "DateTimeInput",
          properties: resolvedProperties
        }));
      case "MultipleChoice":
        if (!isResolvedMultipleChoice(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "MultipleChoice",
          properties: resolvedProperties
        }));
      case "Slider":
        if (!isResolvedSlider(resolvedProperties)) {
          throw new Error(`Invalid data; expected ${componentType}`);
        }
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: "Slider",
          properties: resolvedProperties
        }));
      default:
        return new this.objCtor(__spreadProps(__spreadValues({}, baseNode), {
          type: componentType,
          properties: resolvedProperties
        }));
    }
  }
  /**
   * Recursively resolves an individual property value. If a property indicates
   * a child node (a string that matches a component ID), an explicitList of
   * children, or a template, these will be built out here.
   */
  resolvePropertyValue(value, surface, visited, dataContextPath, idSuffix = "") {
    if (typeof value === "string" && surface.components.has(value)) {
      return this.buildNodeRecursive(value, surface, visited, dataContextPath, idSuffix);
    }
    if (isComponentArrayReference(value)) {
      if (value.explicitList) {
        return value.explicitList.map((id) => this.buildNodeRecursive(id, surface, visited, dataContextPath, idSuffix));
      }
      if (value.template) {
        const fullDataPath = this.resolvePath(value.template.dataBinding, dataContextPath);
        const data = this.getDataByPath(surface.dataModel, fullDataPath);
        const template = value.template;
        if (Array.isArray(data)) {
          return data.map((_, index) => {
            const parentIndices = dataContextPath.split("/").filter((segment) => /^\d+$/.test(segment));
            const newIndices = [...parentIndices, index];
            const newSuffix = `:${newIndices.join(":")}`;
            const childDataContextPath = `${fullDataPath}/${index}`;
            return this.buildNodeRecursive(
              template.componentId,
              // baseId
              surface,
              visited,
              childDataContextPath,
              newSuffix
              // new suffix
            );
          });
        }
        const mapCtor = this.mapCtor;
        if (data instanceof mapCtor) {
          return Array.from(data.keys(), (key) => {
            const newSuffix = `:${key}`;
            const childDataContextPath = `${fullDataPath}/${key}`;
            return this.buildNodeRecursive(
              template.componentId,
              // baseId
              surface,
              visited,
              childDataContextPath,
              newSuffix
              // new suffix
            );
          });
        }
        return new this.arrayCtor();
      }
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.resolvePropertyValue(item, surface, visited, dataContextPath, idSuffix));
    }
    if (isObject(value)) {
      const newObj = new this.objCtor();
      for (const [key, propValue] of Object.entries(value)) {
        let propertyValue = propValue;
        if (isPath(key, propValue) && dataContextPath !== "/") {
          propertyValue = propValue.replace(/^\.?\/item/, "").replace(/^\.?\/text/, "").replace(/^\.?\/label/, "").replace(/^\.?\//, "");
          newObj[key] = propertyValue;
          continue;
        }
        newObj[key] = this.resolvePropertyValue(propertyValue, surface, visited, dataContextPath, idSuffix);
      }
      return newObj;
    }
    return value;
  }
};

// node_modules/@a2ui/web_core/dist/src/v0_8/types/primitives.js
var primitives_exports = {};

// node_modules/@a2ui/web_core/dist/src/v0_8/types/colors.js
var shades = [
  0,
  5,
  10,
  15,
  20,
  25,
  30,
  35,
  40,
  50,
  60,
  70,
  80,
  90,
  95,
  98,
  99,
  100
];

// node_modules/@a2ui/web_core/dist/src/v0_8/styles/index.js
var styles_exports = {};
__export(styles_exports, {
  appendToAll: () => appendToAll,
  createThemeStyles: () => createThemeStyles,
  merge: () => merge,
  structuralStyles: () => structuralStyles,
  toProp: () => toProp
});

// node_modules/@a2ui/web_core/dist/src/v0_8/styles/behavior.js
var opacityBehavior = `
  &:not([disabled]) {
    cursor: pointer;
    opacity: var(--opacity, 0);
    transition: opacity var(--speed, 0.2s) cubic-bezier(0, 0, 0.3, 1);

    &:hover,
    &:focus {
      opacity: 1;
    }
  }`;
var behavior = `
  ${new Array(21).fill(0).map((_, idx) => {
  return `.behavior-ho-${idx * 5} {
          --opacity: ${idx / 20};
          ${opacityBehavior}
        }`;
}).join("\n")}

  .behavior-o-s {
    overflow: scroll;
  }

  .behavior-o-a {
    overflow: auto;
  }

  .behavior-o-h {
    overflow: hidden;
  }

  .behavior-sw-n {
    scrollbar-width: none;
  }
`;

// node_modules/@a2ui/web_core/dist/src/v0_8/styles/shared.js
var grid = 4;

// node_modules/@a2ui/web_core/dist/src/v0_8/styles/border.js
var border = `
  ${new Array(25).fill(0).map((_, idx) => {
  return `
        .border-bw-${idx} { border-width: ${idx}px; }
        .border-btw-${idx} { border-top-width: ${idx}px; }
        .border-bbw-${idx} { border-bottom-width: ${idx}px; }
        .border-blw-${idx} { border-left-width: ${idx}px; }
        .border-brw-${idx} { border-right-width: ${idx}px; }

        .border-ow-${idx} { outline-width: ${idx}px; }
        .border-br-${idx} { border-radius: ${idx * grid}px; overflow: hidden;}`;
}).join("\n")}

  .border-br-50pc {
    border-radius: 50%;
  }

  .border-bs-s {
    border-style: solid;
  }
`;

// node_modules/@a2ui/web_core/dist/src/v0_8/styles/utils.js
function merge(...classes) {
  const styles = {};
  for (const clazz of classes) {
    for (const [key, val] of Object.entries(clazz)) {
      const prefix = key.split("-").with(-1, "").join("-");
      const existingKeys = Object.keys(styles).filter((key2) => key2.startsWith(prefix));
      for (const existingKey of existingKeys) {
        delete styles[existingKey];
      }
      styles[key] = val;
    }
  }
  return styles;
}
function appendToAll(target, exclusions, ...classes) {
  const updatedTarget = structuredClone(target);
  for (const clazz of classes) {
    for (const key of Object.keys(clazz)) {
      const prefix = key.split("-").with(-1, "").join("-");
      for (const [tagName, classesToAdd] of Object.entries(updatedTarget)) {
        if (exclusions.includes(tagName)) {
          continue;
        }
        let found = false;
        for (let t = 0; t < classesToAdd.length; t++) {
          if (classesToAdd[t].startsWith(prefix)) {
            found = true;
            classesToAdd[t] = key;
          }
        }
        if (!found) {
          classesToAdd.push(key);
        }
      }
    }
  }
  return updatedTarget;
}
function createThemeStyles(palettes) {
  const styles = {};
  for (const palette of Object.values(palettes)) {
    for (const [key, val] of Object.entries(palette)) {
      const prop = toProp(key);
      styles[prop] = val;
    }
  }
  return styles;
}
function toProp(key) {
  if (key.startsWith("nv")) {
    return `--nv-${key.slice(2)}`;
  }
  return `--${key[0]}-${key.slice(1)}`;
}

// node_modules/@a2ui/web_core/dist/src/v0_8/styles/colors.js
var color = (src) => `
    ${src.map((key) => {
  const inverseKey = getInverseKey(key);
  return `.color-bc-${key} { border-color: light-dark(var(${toProp(key)}), var(${toProp(inverseKey)})); }`;
}).join("\n")}

    ${src.map((key) => {
  const inverseKey = getInverseKey(key);
  const vals = [
    `.color-bgc-${key} { background-color: light-dark(var(${toProp(key)}), var(${toProp(inverseKey)})); }`,
    `.color-bbgc-${key}::backdrop { background-color: light-dark(var(${toProp(key)}), var(${toProp(inverseKey)})); }`
  ];
  for (let o = 0.1; o < 1; o += 0.1) {
    vals.push(`.color-bbgc-${key}_${(o * 100).toFixed(0)}::backdrop {
            background-color: light-dark(oklch(from var(${toProp(key)}) l c h / calc(alpha * ${o.toFixed(1)})), oklch(from var(${toProp(inverseKey)}) l c h / calc(alpha * ${o.toFixed(1)})) );
          }
        `);
  }
  return vals.join("\n");
}).join("\n")}

  ${src.map((key) => {
  const inverseKey = getInverseKey(key);
  return `.color-c-${key} { color: light-dark(var(${toProp(key)}), var(${toProp(inverseKey)})); }`;
}).join("\n")}
  `;
var getInverseKey = (key) => {
  const match = key.match(/^([a-z]+)(\d+)$/);
  if (!match)
    return key;
  const [, prefix, shadeStr] = match;
  const shade = parseInt(shadeStr, 10);
  const target = 100 - shade;
  const inverseShade = shades.reduce((prev, curr) => Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev);
  return `${prefix}${inverseShade}`;
};
var keyFactory = (prefix) => {
  return shades.map((v) => `${prefix}${v}`);
};
var colors = [
  color(keyFactory("p")),
  color(keyFactory("s")),
  color(keyFactory("t")),
  color(keyFactory("n")),
  color(keyFactory("nv")),
  color(keyFactory("e")),
  `
    .color-bgc-transparent {
      background-color: transparent;
    }

    :host {
      color-scheme: var(--color-scheme);
    }
  `
];

// node_modules/@a2ui/web_core/dist/src/v0_8/styles/icons.js
var icons = `
  .g-icon {
    font-family: "Material Symbols Outlined", "Google Symbols";
    font-weight: normal;
    font-style: normal;
    font-display: optional;
    font-size: 20px;
    width: 1em;
    height: 1em;
    user-select: none;
    line-height: 1;
    letter-spacing: normal;
    text-transform: none;
    display: inline-block;
    white-space: nowrap;
    word-wrap: normal;
    direction: ltr;
    -webkit-font-feature-settings: "liga";
    -webkit-font-smoothing: antialiased;
    overflow: hidden;

    font-variation-settings: "FILL" 0, "wght" 300, "GRAD" 0, "opsz" 48,
      "ROND" 100;

    &.filled {
      font-variation-settings: "FILL" 1, "wght" 300, "GRAD" 0, "opsz" 48,
        "ROND" 100;
    }

    &.filled-heavy {
      font-variation-settings: "FILL" 1, "wght" 700, "GRAD" 0, "opsz" 48,
        "ROND" 100;
    }
  }
`;

// node_modules/@a2ui/web_core/dist/src/v0_8/styles/layout.js
var layout = `
  :host {
    ${new Array(16).fill(0).map((_, idx) => {
  return `--g-${idx + 1}: ${(idx + 1) * grid}px;`;
}).join("\n")}
  }

  ${new Array(49).fill(0).map((_, index) => {
  const idx = index - 24;
  const lbl = idx < 0 ? `n${Math.abs(idx)}` : idx.toString();
  return `
        .layout-p-${lbl} { --padding: ${idx * grid}px; padding: var(--padding); }
        .layout-pt-${lbl} { padding-top: ${idx * grid}px; }
        .layout-pr-${lbl} { padding-right: ${idx * grid}px; }
        .layout-pb-${lbl} { padding-bottom: ${idx * grid}px; }
        .layout-pl-${lbl} { padding-left: ${idx * grid}px; }

        .layout-m-${lbl} { --margin: ${idx * grid}px; margin: var(--margin); }
        .layout-mt-${lbl} { margin-top: ${idx * grid}px; }
        .layout-mr-${lbl} { margin-right: ${idx * grid}px; }
        .layout-mb-${lbl} { margin-bottom: ${idx * grid}px; }
        .layout-ml-${lbl} { margin-left: ${idx * grid}px; }

        .layout-t-${lbl} { top: ${idx * grid}px; }
        .layout-r-${lbl} { right: ${idx * grid}px; }
        .layout-b-${lbl} { bottom: ${idx * grid}px; }
        .layout-l-${lbl} { left: ${idx * grid}px; }`;
}).join("\n")}

  ${new Array(25).fill(0).map((_, idx) => {
  return `
        .layout-g-${idx} { gap: ${idx * grid}px; }`;
}).join("\n")}

  ${new Array(8).fill(0).map((_, idx) => {
  return `
        .layout-grd-col${idx + 1} { grid-template-columns: ${"1fr ".repeat(idx + 1).trim()}; }`;
}).join("\n")}

  .layout-pos-a {
    position: absolute;
  }

  .layout-pos-rel {
    position: relative;
  }

  .layout-dsp-none {
    display: none;
  }

  .layout-dsp-block {
    display: block;
  }

  .layout-dsp-grid {
    display: grid;
  }

  .layout-dsp-iflex {
    display: inline-flex;
  }

  .layout-dsp-flexvert {
    display: flex;
    flex-direction: column;
  }

  .layout-dsp-flexhor {
    display: flex;
    flex-direction: row;
  }

  .layout-fw-w {
    flex-wrap: wrap;
  }

  .layout-al-fs {
    align-items: start;
  }

  .layout-al-fe {
    align-items: end;
  }

  .layout-al-c {
    align-items: center;
  }

  .layout-as-n {
    align-self: normal;
  }

  .layout-js-c {
    justify-self: center;
  }

  .layout-sp-c {
    justify-content: center;
  }

  .layout-sp-ev {
    justify-content: space-evenly;
  }

  .layout-sp-bt {
    justify-content: space-between;
  }

  .layout-sp-s {
    justify-content: start;
  }

  .layout-sp-e {
    justify-content: end;
  }

  .layout-ji-e {
    justify-items: end;
  }

  .layout-r-none {
    resize: none;
  }

  .layout-fs-c {
    field-sizing: content;
  }

  .layout-fs-n {
    field-sizing: none;
  }

  .layout-flx-0 {
    flex: 0 0 auto;
  }

  .layout-flx-1 {
    flex: 1 0 auto;
  }

  .layout-c-s {
    contain: strict;
  }

  /** Widths **/

  ${new Array(10).fill(0).map((_, idx) => {
  const weight = (idx + 1) * 10;
  return `.layout-w-${weight} { width: ${weight}%; max-width: ${weight}%; }`;
}).join("\n")}

  ${new Array(16).fill(0).map((_, idx) => {
  const weight = idx * grid;
  return `.layout-wp-${idx} { width: ${weight}px; }`;
}).join("\n")}

  /** Heights **/

  ${new Array(10).fill(0).map((_, idx) => {
  const height = (idx + 1) * 10;
  return `.layout-h-${height} { height: ${height}%; }`;
}).join("\n")}

  ${new Array(16).fill(0).map((_, idx) => {
  const height = idx * grid;
  return `.layout-hp-${idx} { height: ${height}px; }`;
}).join("\n")}

  .layout-el-cv {
    & img,
    & video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      margin: 0;
    }
  }

  .layout-ar-sq {
    aspect-ratio: 1 / 1;
  }

  .layout-ex-fb {
    margin: calc(var(--padding) * -1) 0 0 calc(var(--padding) * -1);
    width: calc(100% + var(--padding) * 2);
    height: calc(100% + var(--padding) * 2);
  }
`;

// node_modules/@a2ui/web_core/dist/src/v0_8/styles/opacity.js
var opacity = `
  ${new Array(21).fill(0).map((_, idx) => {
  return `.opacity-el-${idx * 5} { opacity: ${idx / 20}; }`;
}).join("\n")}
`;

// node_modules/@a2ui/web_core/dist/src/v0_8/styles/type.js
var type = `
  :host {
    --default-font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    --default-font-family-mono: "Courier New", Courier, monospace;
  }

  .typography-f-s {
    font-family: var(--font-family, var(--default-font-family));
    font-optical-sizing: auto;
    font-variation-settings: "slnt" 0, "wdth" 100, "GRAD" 0;
  }

  .typography-f-sf {
    font-family: var(--font-family-flex, var(--default-font-family));
    font-optical-sizing: auto;
  }

  .typography-f-c {
    font-family: var(--font-family-mono, var(--default-font-family));
    font-optical-sizing: auto;
    font-variation-settings: "slnt" 0, "wdth" 100, "GRAD" 0;
  }

  .typography-v-r {
    font-variation-settings: "slnt" 0, "wdth" 100, "GRAD" 0, "ROND" 100;
  }

  .typography-ta-s {
    text-align: start;
  }

  .typography-ta-c {
    text-align: center;
  }

  .typography-fs-n {
    font-style: normal;
  }

  .typography-fs-i {
    font-style: italic;
  }

  .typography-sz-ls {
    font-size: 11px;
    line-height: 16px;
  }

  .typography-sz-lm {
    font-size: 12px;
    line-height: 16px;
  }

  .typography-sz-ll {
    font-size: 14px;
    line-height: 20px;
  }

  .typography-sz-bs {
    font-size: 12px;
    line-height: 16px;
  }

  .typography-sz-bm {
    font-size: 14px;
    line-height: 20px;
  }

  .typography-sz-bl {
    font-size: 16px;
    line-height: 24px;
  }

  .typography-sz-ts {
    font-size: 14px;
    line-height: 20px;
  }

  .typography-sz-tm {
    font-size: 16px;
    line-height: 24px;
  }

  .typography-sz-tl {
    font-size: 22px;
    line-height: 28px;
  }

  .typography-sz-hs {
    font-size: 24px;
    line-height: 32px;
  }

  .typography-sz-hm {
    font-size: 28px;
    line-height: 36px;
  }

  .typography-sz-hl {
    font-size: 32px;
    line-height: 40px;
  }

  .typography-sz-ds {
    font-size: 36px;
    line-height: 44px;
  }

  .typography-sz-dm {
    font-size: 45px;
    line-height: 52px;
  }

  .typography-sz-dl {
    font-size: 57px;
    line-height: 64px;
  }

  .typography-ws-p {
    white-space: pre-line;
  }

  .typography-ws-nw {
    white-space: nowrap;
  }

  .typography-td-none {
    text-decoration: none;
  }

  /** Weights **/

  ${new Array(9).fill(0).map((_, idx) => {
  const weight = (idx + 1) * 100;
  return `.typography-w-${weight} { font-weight: ${weight}; }`;
}).join("\n")}
`;

// node_modules/@a2ui/web_core/dist/src/v0_8/styles/index.js
var structuralStyles = [
  behavior,
  border,
  colors,
  icons,
  layout,
  opacity,
  type
].flat(Infinity).join("\n");

// node_modules/@a2ui/web_core/dist/src/v0_8/events/index.js
var events_exports2 = {};
__export(events_exports2, {
  A2UIValidationEvent: () => A2UIValidationEvent
});

// node_modules/@a2ui/web_core/dist/src/v0_8/events/validation-event.js
var A2UIValidationEvent = class _A2UIValidationEvent extends CustomEvent {
  static {
    this.EVENT_NAME = "a2ui-validation-input";
  }
  constructor(detail, eventInitDict) {
    super(_A2UIValidationEvent.EVENT_NAME, __spreadProps(__spreadValues({
      bubbles: true,
      composed: true
    }, eventInitDict), {
      detail: __spreadProps(__spreadValues({}, detail), {
        eventType: _A2UIValidationEvent.EVENT_NAME
      })
    }));
  }
};

// node_modules/@a2ui/web_core/dist/src/v0_8/schemas/server_to_client_with_standard_catalog.json
var server_to_client_with_standard_catalog_default = {
  title: "A2UI Message Schema",
  description: "Describes a JSON payload for an A2UI (Agent to UI) message, which is used to dynamically construct and update user interfaces. A message MUST contain exactly ONE of the action properties: 'beginRendering', 'surfaceUpdate', 'dataModelUpdate', or 'deleteSurface'.",
  type: "object",
  additionalProperties: false,
  properties: {
    beginRendering: {
      type: "object",
      description: "Signals the client to begin rendering a surface with a root component and specific styles.",
      additionalProperties: false,
      properties: {
        surfaceId: {
          type: "string",
          description: "The unique identifier for the UI surface to be rendered."
        },
        root: {
          type: "string",
          description: "The ID of the root component to render."
        },
        styles: {
          type: "object",
          description: "Styling information for the UI.",
          additionalProperties: false,
          properties: {
            font: {
              type: "string",
              description: "The primary font for the UI."
            },
            primaryColor: {
              type: "string",
              description: "The primary UI color as a hexadecimal code (e.g., '#00BFFF').",
              pattern: "^#[0-9a-fA-F]{6}$"
            }
          }
        }
      },
      required: ["root", "surfaceId"]
    },
    surfaceUpdate: {
      type: "object",
      description: "Updates a surface with a new set of components.",
      additionalProperties: false,
      properties: {
        surfaceId: {
          type: "string",
          description: "The unique identifier for the UI surface to be updated. If you are adding a new surface this *must* be a new, unique identified that has never been used for any existing surfaces shown."
        },
        components: {
          type: "array",
          description: "A list containing all UI components for the surface.",
          minItems: 1,
          items: {
            type: "object",
            description: "Represents a *single* component in a UI widget tree. This component could be one of many supported types.",
            additionalProperties: false,
            properties: {
              id: {
                type: "string",
                description: "The unique identifier for this component."
              },
              weight: {
                type: "number",
                description: "The relative weight of this component within a Row or Column. This corresponds to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
              },
              component: {
                type: "object",
                description: "A wrapper object that MUST contain exactly one key, which is the name of the component type (e.g., 'Heading'). The value is an object containing the properties for that specific component.",
                additionalProperties: false,
                properties: {
                  Text: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      text: {
                        type: "object",
                        description: "The text content to display. This can be a literal string or a reference to a value in the data model ('path', e.g., '/doc/title'). While simple Markdown formatting is supported (i.e. without HTML, images, or links), utilizing dedicated UI components is generally preferred for a richer and more structured presentation.",
                        additionalProperties: false,
                        properties: {
                          literalString: {
                            type: "string"
                          },
                          path: {
                            type: "string"
                          }
                        }
                      },
                      usageHint: {
                        type: "string",
                        description: "A hint for the base text style. One of:\n- `h1`: Largest heading.\n- `h2`: Second largest heading.\n- `h3`: Third largest heading.\n- `h4`: Fourth largest heading.\n- `h5`: Fifth largest heading.\n- `caption`: Small text for captions.\n- `body`: Standard body text.",
                        enum: [
                          "h1",
                          "h2",
                          "h3",
                          "h4",
                          "h5",
                          "caption",
                          "body"
                        ]
                      }
                    },
                    required: ["text"]
                  },
                  Image: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      url: {
                        type: "object",
                        description: "The URL of the image to display. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/thumbnail/url').",
                        additionalProperties: false,
                        properties: {
                          literalString: {
                            type: "string"
                          },
                          path: {
                            type: "string"
                          }
                        }
                      },
                      fit: {
                        type: "string",
                        description: "Specifies how the image should be resized to fit its container. This corresponds to the CSS 'object-fit' property.",
                        enum: [
                          "contain",
                          "cover",
                          "fill",
                          "none",
                          "scale-down"
                        ]
                      },
                      usageHint: {
                        type: "string",
                        description: "A hint for the image size and style. One of:\n- `icon`: Small square icon.\n- `avatar`: Circular avatar image.\n- `smallFeature`: Small feature image.\n- `mediumFeature`: Medium feature image.\n- `largeFeature`: Large feature image.\n- `header`: Full-width, full bleed, header image.",
                        enum: [
                          "icon",
                          "avatar",
                          "smallFeature",
                          "mediumFeature",
                          "largeFeature",
                          "header"
                        ]
                      }
                    },
                    required: ["url"]
                  },
                  Icon: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      name: {
                        type: "object",
                        description: "The name of the icon to display. This can be a literal string or a reference to a value in the data model ('path', e.g. '/form/submit').",
                        additionalProperties: false,
                        properties: {
                          literalString: {
                            type: "string",
                            enum: [
                              "accountCircle",
                              "add",
                              "arrowBack",
                              "arrowForward",
                              "attachFile",
                              "calendarToday",
                              "call",
                              "camera",
                              "check",
                              "close",
                              "delete",
                              "download",
                              "edit",
                              "event",
                              "error",
                              "favorite",
                              "favoriteOff",
                              "folder",
                              "help",
                              "home",
                              "info",
                              "locationOn",
                              "lock",
                              "lockOpen",
                              "mail",
                              "menu",
                              "moreVert",
                              "moreHoriz",
                              "notificationsOff",
                              "notifications",
                              "payment",
                              "person",
                              "phone",
                              "photo",
                              "print",
                              "refresh",
                              "search",
                              "send",
                              "settings",
                              "share",
                              "shoppingCart",
                              "star",
                              "starHalf",
                              "starOff",
                              "upload",
                              "visibility",
                              "visibilityOff",
                              "warning"
                            ]
                          },
                          path: {
                            type: "string"
                          }
                        }
                      }
                    },
                    required: ["name"]
                  },
                  Video: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      url: {
                        type: "object",
                        description: "The URL of the video to display. This can be a literal string or a reference to a value in the data model ('path', e.g. '/video/url').",
                        additionalProperties: false,
                        properties: {
                          literalString: {
                            type: "string"
                          },
                          path: {
                            type: "string"
                          }
                        }
                      }
                    },
                    required: ["url"]
                  },
                  AudioPlayer: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      url: {
                        type: "object",
                        description: "The URL of the audio to be played. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/song/url').",
                        additionalProperties: false,
                        properties: {
                          literalString: {
                            type: "string"
                          },
                          path: {
                            type: "string"
                          }
                        }
                      },
                      description: {
                        type: "object",
                        description: "A description of the audio, such as a title or summary. This can be a literal string or a reference to a value in the data model ('path', e.g. '/song/title').",
                        additionalProperties: false,
                        properties: {
                          literalString: {
                            type: "string"
                          },
                          path: {
                            type: "string"
                          }
                        }
                      }
                    },
                    required: ["url"]
                  },
                  Row: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      children: {
                        type: "object",
                        description: "Defines the children. Use 'explicitList' for a fixed set of children, or 'template' to generate children from a data list.",
                        additionalProperties: false,
                        properties: {
                          explicitList: {
                            type: "array",
                            items: {
                              type: "string"
                            }
                          },
                          template: {
                            type: "object",
                            description: "A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.",
                            additionalProperties: false,
                            properties: {
                              componentId: {
                                type: "string"
                              },
                              dataBinding: {
                                type: "string"
                              }
                            },
                            required: ["componentId", "dataBinding"]
                          }
                        }
                      },
                      distribution: {
                        type: "string",
                        description: "Defines the arrangement of children along the main axis (horizontally). This corresponds to the CSS 'justify-content' property.",
                        enum: [
                          "center",
                          "end",
                          "spaceAround",
                          "spaceBetween",
                          "spaceEvenly",
                          "start"
                        ]
                      },
                      alignment: {
                        type: "string",
                        description: "Defines the alignment of children along the cross axis (vertically). This corresponds to the CSS 'align-items' property.",
                        enum: ["start", "center", "end", "stretch"]
                      }
                    },
                    required: ["children"]
                  },
                  Column: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      children: {
                        type: "object",
                        description: "Defines the children. Use 'explicitList' for a fixed set of children, or 'template' to generate children from a data list.",
                        additionalProperties: false,
                        properties: {
                          explicitList: {
                            type: "array",
                            items: {
                              type: "string"
                            }
                          },
                          template: {
                            type: "object",
                            description: "A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.",
                            additionalProperties: false,
                            properties: {
                              componentId: {
                                type: "string"
                              },
                              dataBinding: {
                                type: "string"
                              }
                            },
                            required: ["componentId", "dataBinding"]
                          }
                        }
                      },
                      distribution: {
                        type: "string",
                        description: "Defines the arrangement of children along the main axis (vertically). This corresponds to the CSS 'justify-content' property.",
                        enum: [
                          "start",
                          "center",
                          "end",
                          "spaceBetween",
                          "spaceAround",
                          "spaceEvenly"
                        ]
                      },
                      alignment: {
                        type: "string",
                        description: "Defines the alignment of children along the cross axis (horizontally). This corresponds to the CSS 'align-items' property.",
                        enum: ["center", "end", "start", "stretch"]
                      }
                    },
                    required: ["children"]
                  },
                  List: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      children: {
                        type: "object",
                        description: "Defines the children. Use 'explicitList' for a fixed set of children, or 'template' to generate children from a data list.",
                        additionalProperties: false,
                        properties: {
                          explicitList: {
                            type: "array",
                            items: {
                              type: "string"
                            }
                          },
                          template: {
                            type: "object",
                            description: "A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.",
                            additionalProperties: false,
                            properties: {
                              componentId: {
                                type: "string"
                              },
                              dataBinding: {
                                type: "string"
                              }
                            },
                            required: ["componentId", "dataBinding"]
                          }
                        }
                      },
                      direction: {
                        type: "string",
                        description: "The direction in which the list items are laid out.",
                        enum: ["vertical", "horizontal"]
                      },
                      alignment: {
                        type: "string",
                        description: "Defines the alignment of children along the cross axis.",
                        enum: ["start", "center", "end", "stretch"]
                      }
                    },
                    required: ["children"]
                  },
                  Card: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      child: {
                        type: "string",
                        description: "The ID of the component to be rendered inside the card."
                      }
                    },
                    required: ["child"]
                  },
                  Tabs: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      tabItems: {
                        type: "array",
                        description: "An array of objects, where each object defines a tab with a title and a child component.",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            title: {
                              type: "object",
                              description: "The tab title. Defines the value as either a literal value or a path to data model value (e.g. '/options/title').",
                              additionalProperties: false,
                              properties: {
                                literalString: {
                                  type: "string"
                                },
                                path: {
                                  type: "string"
                                }
                              }
                            },
                            child: {
                              type: "string"
                            }
                          },
                          required: ["title", "child"]
                        }
                      }
                    },
                    required: ["tabItems"]
                  },
                  Divider: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      axis: {
                        type: "string",
                        description: "The orientation of the divider.",
                        enum: ["horizontal", "vertical"]
                      }
                    }
                  },
                  Modal: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      entryPointChild: {
                        type: "string",
                        description: "The ID of the component that opens the modal when interacted with (e.g., a button)."
                      },
                      contentChild: {
                        type: "string",
                        description: "The ID of the component to be displayed inside the modal."
                      }
                    },
                    required: ["entryPointChild", "contentChild"]
                  },
                  Button: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      child: {
                        type: "string",
                        description: "The ID of the component to display in the button, typically a Text component."
                      },
                      primary: {
                        type: "boolean",
                        description: "Indicates if this button should be styled as the primary action."
                      },
                      action: {
                        type: "object",
                        description: "The client-side action to be dispatched when the button is clicked. It includes the action's name and an optional context payload.",
                        additionalProperties: false,
                        properties: {
                          name: {
                            type: "string"
                          },
                          context: {
                            type: "array",
                            items: {
                              type: "object",
                              additionalProperties: false,
                              properties: {
                                key: {
                                  type: "string"
                                },
                                value: {
                                  type: "object",
                                  description: "Defines the value to be included in the context as either a literal value or a path to a data model value (e.g. '/user/name').",
                                  additionalProperties: false,
                                  properties: {
                                    path: {
                                      type: "string"
                                    },
                                    literalString: {
                                      type: "string"
                                    },
                                    literalNumber: {
                                      type: "number"
                                    },
                                    literalBoolean: {
                                      type: "boolean"
                                    }
                                  }
                                }
                              },
                              required: ["key", "value"]
                            }
                          }
                        },
                        required: ["name"]
                      }
                    },
                    required: ["child", "action"]
                  },
                  CheckBox: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      label: {
                        type: "object",
                        description: "The text to display next to the checkbox. Defines the value as either a literal value or a path to data model ('path', e.g. '/option/label').",
                        additionalProperties: false,
                        properties: {
                          literalString: {
                            type: "string"
                          },
                          path: {
                            type: "string"
                          }
                        }
                      },
                      value: {
                        type: "object",
                        description: "The current state of the checkbox (true for checked, false for unchecked). This can be a literal boolean ('literalBoolean') or a reference to a value in the data model ('path', e.g. '/filter/open').",
                        additionalProperties: false,
                        properties: {
                          literalBoolean: {
                            type: "boolean"
                          },
                          path: {
                            type: "string"
                          }
                        }
                      }
                    },
                    required: ["label", "value"]
                  },
                  TextField: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      label: {
                        type: "object",
                        description: "The text label for the input field. This can be a literal string or a reference to a value in the data model ('path, e.g. '/user/name').",
                        additionalProperties: false,
                        properties: {
                          literalString: {
                            type: "string"
                          },
                          path: {
                            type: "string"
                          }
                        }
                      },
                      text: {
                        type: "object",
                        description: "The value of the text field. This can be a literal string or a reference to a value in the data model ('path', e.g. '/user/name').",
                        additionalProperties: false,
                        properties: {
                          literalString: {
                            type: "string"
                          },
                          path: {
                            type: "string"
                          }
                        }
                      },
                      textFieldType: {
                        type: "string",
                        description: "The type of input field to display.",
                        enum: [
                          "date",
                          "longText",
                          "number",
                          "shortText",
                          "obscured"
                        ]
                      },
                      validationRegexp: {
                        type: "string",
                        description: "A regular expression used for client-side validation of the input."
                      }
                    },
                    required: ["label"]
                  },
                  DateTimeInput: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      value: {
                        type: "object",
                        description: "The selected date and/or time value in ISO 8601 format. This can be a literal string ('literalString') or a reference to a value in the data model ('path', e.g. '/user/dob').",
                        additionalProperties: false,
                        properties: {
                          literalString: {
                            type: "string"
                          },
                          path: {
                            type: "string"
                          }
                        }
                      },
                      enableDate: {
                        type: "boolean",
                        description: "If true, allows the user to select a date."
                      },
                      enableTime: {
                        type: "boolean",
                        description: "If true, allows the user to select a time."
                      }
                    },
                    required: ["value"]
                  },
                  MultipleChoice: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      selections: {
                        type: "object",
                        description: "The currently selected values for the component. This can be a literal array of strings or a path to an array in the data model('path', e.g. '/hotel/options').",
                        additionalProperties: false,
                        properties: {
                          literalArray: {
                            type: "array",
                            items: {
                              type: "string"
                            }
                          },
                          path: {
                            type: "string"
                          }
                        }
                      },
                      options: {
                        type: "array",
                        description: "An array of available options for the user to choose from.",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            label: {
                              type: "object",
                              description: "The text to display for this option. This can be a literal string or a reference to a value in the data model (e.g. '/option/label').",
                              additionalProperties: false,
                              properties: {
                                literalString: {
                                  type: "string"
                                },
                                path: {
                                  type: "string"
                                }
                              }
                            },
                            value: {
                              type: "string",
                              description: "The value to be associated with this option when selected."
                            }
                          },
                          required: ["label", "value"]
                        }
                      },
                      maxAllowedSelections: {
                        type: "integer",
                        description: "The maximum number of options that the user is allowed to select."
                      }
                    },
                    required: ["selections", "options"]
                  },
                  Slider: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      value: {
                        type: "object",
                        description: "The current value of the slider. This can be a literal number ('literalNumber') or a reference to a value in the data model ('path', e.g. '/restaurant/cost').",
                        additionalProperties: false,
                        properties: {
                          literalNumber: {
                            type: "number"
                          },
                          path: {
                            type: "string"
                          }
                        }
                      },
                      minValue: {
                        type: "number",
                        description: "The minimum value of the slider."
                      },
                      maxValue: {
                        type: "number",
                        description: "The maximum value of the slider."
                      }
                    },
                    required: ["value"]
                  }
                }
              }
            },
            required: ["id", "component"]
          }
        }
      },
      required: ["surfaceId", "components"]
    },
    dataModelUpdate: {
      type: "object",
      description: "Updates the data model for a surface.",
      additionalProperties: false,
      properties: {
        surfaceId: {
          type: "string",
          description: "The unique identifier for the UI surface this data model update applies to."
        },
        path: {
          type: "string",
          description: "An optional path to a location within the data model (e.g., '/user/name'). If omitted, or set to '/', the entire data model will be replaced."
        },
        contents: {
          type: "array",
          description: "An array of data entries. Each entry must contain a 'key' and exactly one corresponding typed 'value*' property.",
          items: {
            type: "object",
            description: "A single data entry. Exactly one 'value*' property should be provided alongside the key.",
            additionalProperties: false,
            properties: {
              key: {
                type: "string",
                description: "The key for this data entry."
              },
              valueString: {
                type: "string"
              },
              valueNumber: {
                type: "number"
              },
              valueBoolean: {
                type: "boolean"
              },
              valueMap: {
                description: "Represents a map as an adjacency list.",
                type: "array",
                items: {
                  type: "object",
                  description: "One entry in the map. Exactly one 'value*' property should be provided alongside the key.",
                  additionalProperties: false,
                  properties: {
                    key: {
                      type: "string"
                    },
                    valueString: {
                      type: "string"
                    },
                    valueNumber: {
                      type: "number"
                    },
                    valueBoolean: {
                      type: "boolean"
                    }
                  },
                  required: ["key"]
                }
              }
            },
            required: ["key"]
          }
        }
      },
      required: ["contents", "surfaceId"]
    },
    deleteSurface: {
      type: "object",
      description: "Signals the client to delete the surface identified by 'surfaceId'.",
      additionalProperties: false,
      properties: {
        surfaceId: {
          type: "string",
          description: "The unique identifier for the UI surface to be deleted."
        }
      },
      required: ["surfaceId"]
    }
  }
};

// node_modules/@a2ui/web_core/dist/src/v0_8/index.js
var Schemas = {
  A2UIClientEventMessage: server_to_client_with_standard_catalog_default
};

// node_modules/signal-polyfill/dist/index.js
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
var __accessCheck = (obj, member, msg) => {
  if (!member.has(obj))
    throw TypeError("Cannot " + msg);
};
var __privateIn = (member, obj) => {
  if (Object(obj) !== obj)
    throw TypeError('Cannot use the "in" operator on this value');
  return member.has(obj);
};
var __privateAdd = (obj, member, value) => {
  if (member.has(obj))
    throw TypeError("Cannot add the same private member more than once");
  member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
};
var __privateMethod = (obj, member, method) => {
  __accessCheck(obj, member, "access private method");
  return method;
};
function defaultEquals(a, b) {
  return Object.is(a, b);
}
var activeConsumer = null;
var inNotificationPhase = false;
var epoch = 1;
var SIGNAL = /* @__PURE__ */ Symbol("SIGNAL");
function setActiveConsumer(consumer) {
  const prev = activeConsumer;
  activeConsumer = consumer;
  return prev;
}
function getActiveConsumer() {
  return activeConsumer;
}
function isInNotificationPhase() {
  return inNotificationPhase;
}
var REACTIVE_NODE = {
  version: 0,
  lastCleanEpoch: 0,
  dirty: false,
  producerNode: void 0,
  producerLastReadVersion: void 0,
  producerIndexOfThis: void 0,
  nextProducerIndex: 0,
  liveConsumerNode: void 0,
  liveConsumerIndexOfThis: void 0,
  consumerAllowSignalWrites: false,
  consumerIsAlwaysLive: false,
  producerMustRecompute: () => false,
  producerRecomputeValue: () => {
  },
  consumerMarkedDirty: () => {
  },
  consumerOnSignalRead: () => {
  }
};
function producerAccessed(node) {
  if (inNotificationPhase) {
    throw new Error(
      typeof ngDevMode !== "undefined" && ngDevMode ? `Assertion error: signal read during notification phase` : ""
    );
  }
  if (activeConsumer === null) {
    return;
  }
  activeConsumer.consumerOnSignalRead(node);
  const idx = activeConsumer.nextProducerIndex++;
  assertConsumerNode(activeConsumer);
  if (idx < activeConsumer.producerNode.length && activeConsumer.producerNode[idx] !== node) {
    if (consumerIsLive(activeConsumer)) {
      const staleProducer = activeConsumer.producerNode[idx];
      producerRemoveLiveConsumerAtIndex(staleProducer, activeConsumer.producerIndexOfThis[idx]);
    }
  }
  if (activeConsumer.producerNode[idx] !== node) {
    activeConsumer.producerNode[idx] = node;
    activeConsumer.producerIndexOfThis[idx] = consumerIsLive(activeConsumer) ? producerAddLiveConsumer(node, activeConsumer, idx) : 0;
  }
  activeConsumer.producerLastReadVersion[idx] = node.version;
}
function producerIncrementEpoch() {
  epoch++;
}
function producerUpdateValueVersion(node) {
  if (!node.dirty && node.lastCleanEpoch === epoch) {
    return;
  }
  if (!node.producerMustRecompute(node) && !consumerPollProducersForChange(node)) {
    node.dirty = false;
    node.lastCleanEpoch = epoch;
    return;
  }
  node.producerRecomputeValue(node);
  node.dirty = false;
  node.lastCleanEpoch = epoch;
}
function producerNotifyConsumers(node) {
  if (node.liveConsumerNode === void 0) {
    return;
  }
  const prev = inNotificationPhase;
  inNotificationPhase = true;
  try {
    for (const consumer of node.liveConsumerNode) {
      if (!consumer.dirty) {
        consumerMarkDirty(consumer);
      }
    }
  } finally {
    inNotificationPhase = prev;
  }
}
function producerUpdatesAllowed() {
  return (activeConsumer == null ? void 0 : activeConsumer.consumerAllowSignalWrites) !== false;
}
function consumerMarkDirty(node) {
  var _a;
  node.dirty = true;
  producerNotifyConsumers(node);
  (_a = node.consumerMarkedDirty) == null ? void 0 : _a.call(node.wrapper ?? node);
}
function consumerBeforeComputation(node) {
  node && (node.nextProducerIndex = 0);
  return setActiveConsumer(node);
}
function consumerAfterComputation(node, prevConsumer) {
  setActiveConsumer(prevConsumer);
  if (!node || node.producerNode === void 0 || node.producerIndexOfThis === void 0 || node.producerLastReadVersion === void 0) {
    return;
  }
  if (consumerIsLive(node)) {
    for (let i = node.nextProducerIndex; i < node.producerNode.length; i++) {
      producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);
    }
  }
  while (node.producerNode.length > node.nextProducerIndex) {
    node.producerNode.pop();
    node.producerLastReadVersion.pop();
    node.producerIndexOfThis.pop();
  }
}
function consumerPollProducersForChange(node) {
  assertConsumerNode(node);
  for (let i = 0; i < node.producerNode.length; i++) {
    const producer = node.producerNode[i];
    const seenVersion = node.producerLastReadVersion[i];
    if (seenVersion !== producer.version) {
      return true;
    }
    producerUpdateValueVersion(producer);
    if (seenVersion !== producer.version) {
      return true;
    }
  }
  return false;
}
function producerAddLiveConsumer(node, consumer, indexOfThis) {
  var _a;
  assertProducerNode(node);
  assertConsumerNode(node);
  if (node.liveConsumerNode.length === 0) {
    (_a = node.watched) == null ? void 0 : _a.call(node.wrapper);
    for (let i = 0; i < node.producerNode.length; i++) {
      node.producerIndexOfThis[i] = producerAddLiveConsumer(node.producerNode[i], node, i);
    }
  }
  node.liveConsumerIndexOfThis.push(indexOfThis);
  return node.liveConsumerNode.push(consumer) - 1;
}
function producerRemoveLiveConsumerAtIndex(node, idx) {
  var _a;
  assertProducerNode(node);
  assertConsumerNode(node);
  if (typeof ngDevMode !== "undefined" && ngDevMode && idx >= node.liveConsumerNode.length) {
    throw new Error(
      `Assertion error: active consumer index ${idx} is out of bounds of ${node.liveConsumerNode.length} consumers)`
    );
  }
  if (node.liveConsumerNode.length === 1) {
    (_a = node.unwatched) == null ? void 0 : _a.call(node.wrapper);
    for (let i = 0; i < node.producerNode.length; i++) {
      producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);
    }
  }
  const lastIdx = node.liveConsumerNode.length - 1;
  node.liveConsumerNode[idx] = node.liveConsumerNode[lastIdx];
  node.liveConsumerIndexOfThis[idx] = node.liveConsumerIndexOfThis[lastIdx];
  node.liveConsumerNode.length--;
  node.liveConsumerIndexOfThis.length--;
  if (idx < node.liveConsumerNode.length) {
    const idxProducer = node.liveConsumerIndexOfThis[idx];
    const consumer = node.liveConsumerNode[idx];
    assertConsumerNode(consumer);
    consumer.producerIndexOfThis[idxProducer] = idx;
  }
}
function consumerIsLive(node) {
  var _a;
  return node.consumerIsAlwaysLive || (((_a = node == null ? void 0 : node.liveConsumerNode) == null ? void 0 : _a.length) ?? 0) > 0;
}
function assertConsumerNode(node) {
  node.producerNode ?? (node.producerNode = []);
  node.producerIndexOfThis ?? (node.producerIndexOfThis = []);
  node.producerLastReadVersion ?? (node.producerLastReadVersion = []);
}
function assertProducerNode(node) {
  node.liveConsumerNode ?? (node.liveConsumerNode = []);
  node.liveConsumerIndexOfThis ?? (node.liveConsumerIndexOfThis = []);
}
function computedGet(node) {
  producerUpdateValueVersion(node);
  producerAccessed(node);
  if (node.value === ERRORED) {
    throw node.error;
  }
  return node.value;
}
function createComputed(computation) {
  const node = Object.create(COMPUTED_NODE);
  node.computation = computation;
  const computed = () => computedGet(node);
  computed[SIGNAL] = node;
  return computed;
}
var UNSET = /* @__PURE__ */ Symbol("UNSET");
var COMPUTING = /* @__PURE__ */ Symbol("COMPUTING");
var ERRORED = /* @__PURE__ */ Symbol("ERRORED");
var COMPUTED_NODE = (() => {
  return __spreadProps(__spreadValues({}, REACTIVE_NODE), {
    value: UNSET,
    dirty: true,
    error: null,
    equal: defaultEquals,
    producerMustRecompute(node) {
      return node.value === UNSET || node.value === COMPUTING;
    },
    producerRecomputeValue(node) {
      if (node.value === COMPUTING) {
        throw new Error("Detected cycle in computations.");
      }
      const oldValue = node.value;
      node.value = COMPUTING;
      const prevConsumer = consumerBeforeComputation(node);
      let newValue;
      let wasEqual = false;
      try {
        newValue = node.computation.call(node.wrapper);
        const oldOk = oldValue !== UNSET && oldValue !== ERRORED;
        wasEqual = oldOk && node.equal.call(node.wrapper, oldValue, newValue);
      } catch (err) {
        newValue = ERRORED;
        node.error = err;
      } finally {
        consumerAfterComputation(node, prevConsumer);
      }
      if (wasEqual) {
        node.value = oldValue;
        return;
      }
      node.value = newValue;
      node.version++;
    }
  });
})();
function defaultThrowError() {
  throw new Error();
}
var throwInvalidWriteToSignalErrorFn = defaultThrowError;
function throwInvalidWriteToSignalError() {
  throwInvalidWriteToSignalErrorFn();
}
function createSignal(initialValue) {
  const node = Object.create(SIGNAL_NODE);
  node.value = initialValue;
  const getter = () => {
    producerAccessed(node);
    return node.value;
  };
  getter[SIGNAL] = node;
  return getter;
}
function signalGetFn() {
  producerAccessed(this);
  return this.value;
}
function signalSetFn(node, newValue) {
  if (!producerUpdatesAllowed()) {
    throwInvalidWriteToSignalError();
  }
  if (!node.equal.call(node.wrapper, node.value, newValue)) {
    node.value = newValue;
    signalValueChanged(node);
  }
}
var SIGNAL_NODE = (() => {
  return __spreadProps(__spreadValues({}, REACTIVE_NODE), {
    equal: defaultEquals,
    value: void 0
  });
})();
function signalValueChanged(node) {
  node.version++;
  producerIncrementEpoch();
  producerNotifyConsumers(node);
}
var NODE = /* @__PURE__ */ Symbol("node");
var Signal;
((Signal2) => {
  var _a, _brand, brand_fn, _b, _brand2, brand_fn2;
  class State {
    constructor(initialValue, options = {}) {
      __privateAdd(this, _brand);
      __publicField(this, _a);
      const ref = createSignal(initialValue);
      const node = ref[SIGNAL];
      this[NODE] = node;
      node.wrapper = this;
      if (options) {
        const equals = options.equals;
        if (equals) {
          node.equal = equals;
        }
        node.watched = options[Signal2.subtle.watched];
        node.unwatched = options[Signal2.subtle.unwatched];
      }
    }
    get() {
      if (!(0, Signal2.isState)(this))
        throw new TypeError("Wrong receiver type for Signal.State.prototype.get");
      return signalGetFn.call(this[NODE]);
    }
    set(newValue) {
      if (!(0, Signal2.isState)(this))
        throw new TypeError("Wrong receiver type for Signal.State.prototype.set");
      if (isInNotificationPhase()) {
        throw new Error("Writes to signals not permitted during Watcher callback");
      }
      const ref = this[NODE];
      signalSetFn(ref, newValue);
    }
  }
  _a = NODE;
  _brand = /* @__PURE__ */ new WeakSet();
  brand_fn = function() {
  };
  Signal2.isState = (s) => typeof s === "object" && __privateIn(_brand, s);
  Signal2.State = State;
  class Computed {
    // Create a Signal which evaluates to the value returned by the callback.
    // Callback is called with this signal as the parameter.
    constructor(computation, options) {
      __privateAdd(this, _brand2);
      __publicField(this, _b);
      const ref = createComputed(computation);
      const node = ref[SIGNAL];
      node.consumerAllowSignalWrites = true;
      this[NODE] = node;
      node.wrapper = this;
      if (options) {
        const equals = options.equals;
        if (equals) {
          node.equal = equals;
        }
        node.watched = options[Signal2.subtle.watched];
        node.unwatched = options[Signal2.subtle.unwatched];
      }
    }
    get() {
      if (!(0, Signal2.isComputed)(this))
        throw new TypeError("Wrong receiver type for Signal.Computed.prototype.get");
      return computedGet(this[NODE]);
    }
  }
  _b = NODE;
  _brand2 = /* @__PURE__ */ new WeakSet();
  brand_fn2 = function() {
  };
  Signal2.isComputed = (c) => typeof c === "object" && __privateIn(_brand2, c);
  Signal2.Computed = Computed;
  ((subtle2) => {
    var _a2, _brand3, brand_fn3, _assertSignals, assertSignals_fn;
    function untrack(cb) {
      let output;
      let prevActiveConsumer = null;
      try {
        prevActiveConsumer = setActiveConsumer(null);
        output = cb();
      } finally {
        setActiveConsumer(prevActiveConsumer);
      }
      return output;
    }
    subtle2.untrack = untrack;
    function introspectSources(sink) {
      var _a3;
      if (!(0, Signal2.isComputed)(sink) && !(0, Signal2.isWatcher)(sink)) {
        throw new TypeError("Called introspectSources without a Computed or Watcher argument");
      }
      return ((_a3 = sink[NODE].producerNode) == null ? void 0 : _a3.map((n) => n.wrapper)) ?? [];
    }
    subtle2.introspectSources = introspectSources;
    function introspectSinks(signal) {
      var _a3;
      if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isState)(signal)) {
        throw new TypeError("Called introspectSinks without a Signal argument");
      }
      return ((_a3 = signal[NODE].liveConsumerNode) == null ? void 0 : _a3.map((n) => n.wrapper)) ?? [];
    }
    subtle2.introspectSinks = introspectSinks;
    function hasSinks(signal) {
      if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isState)(signal)) {
        throw new TypeError("Called hasSinks without a Signal argument");
      }
      const liveConsumerNode = signal[NODE].liveConsumerNode;
      if (!liveConsumerNode)
        return false;
      return liveConsumerNode.length > 0;
    }
    subtle2.hasSinks = hasSinks;
    function hasSources(signal) {
      if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isWatcher)(signal)) {
        throw new TypeError("Called hasSources without a Computed or Watcher argument");
      }
      const producerNode = signal[NODE].producerNode;
      if (!producerNode)
        return false;
      return producerNode.length > 0;
    }
    subtle2.hasSources = hasSources;
    class Watcher {
      // When a (recursive) source of Watcher is written to, call this callback,
      // if it hasn't already been called since the last `watch` call.
      // No signals may be read or written during the notify.
      constructor(notify) {
        __privateAdd(this, _brand3);
        __privateAdd(this, _assertSignals);
        __publicField(this, _a2);
        let node = Object.create(REACTIVE_NODE);
        node.wrapper = this;
        node.consumerMarkedDirty = notify;
        node.consumerIsAlwaysLive = true;
        node.consumerAllowSignalWrites = false;
        node.producerNode = [];
        this[NODE] = node;
      }
      // Add these signals to the Watcher's set, and set the watcher to run its
      // notify callback next time any signal in the set (or one of its dependencies) changes.
      // Can be called with no arguments just to reset the "notified" state, so that
      // the notify callback will be invoked again.
      watch(...signals) {
        if (!(0, Signal2.isWatcher)(this)) {
          throw new TypeError("Called unwatch without Watcher receiver");
        }
        __privateMethod(this, _assertSignals, assertSignals_fn).call(this, signals);
        const node = this[NODE];
        node.dirty = false;
        const prev = setActiveConsumer(node);
        for (const signal of signals) {
          producerAccessed(signal[NODE]);
        }
        setActiveConsumer(prev);
      }
      // Remove these signals from the watched set (e.g., for an effect which is disposed)
      unwatch(...signals) {
        if (!(0, Signal2.isWatcher)(this)) {
          throw new TypeError("Called unwatch without Watcher receiver");
        }
        __privateMethod(this, _assertSignals, assertSignals_fn).call(this, signals);
        const node = this[NODE];
        assertConsumerNode(node);
        for (let i = node.producerNode.length - 1; i >= 0; i--) {
          if (signals.includes(node.producerNode[i].wrapper)) {
            producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);
            const lastIdx = node.producerNode.length - 1;
            node.producerNode[i] = node.producerNode[lastIdx];
            node.producerIndexOfThis[i] = node.producerIndexOfThis[lastIdx];
            node.producerNode.length--;
            node.producerIndexOfThis.length--;
            node.nextProducerIndex--;
            if (i < node.producerNode.length) {
              const idxConsumer = node.producerIndexOfThis[i];
              const producer = node.producerNode[i];
              assertProducerNode(producer);
              producer.liveConsumerIndexOfThis[idxConsumer] = i;
            }
          }
        }
      }
      // Returns the set of computeds in the Watcher's set which are still yet
      // to be re-evaluated
      getPending() {
        if (!(0, Signal2.isWatcher)(this)) {
          throw new TypeError("Called getPending without Watcher receiver");
        }
        const node = this[NODE];
        return node.producerNode.filter((n) => n.dirty).map((n) => n.wrapper);
      }
    }
    _a2 = NODE;
    _brand3 = /* @__PURE__ */ new WeakSet();
    brand_fn3 = function() {
    };
    _assertSignals = /* @__PURE__ */ new WeakSet();
    assertSignals_fn = function(signals) {
      for (const signal of signals) {
        if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isState)(signal)) {
          throw new TypeError("Called watch/unwatch without a Computed or State argument");
        }
      }
    };
    Signal2.isWatcher = (w) => __privateIn(_brand3, w);
    subtle2.Watcher = Watcher;
    function currentComputed() {
      var _a3;
      return (_a3 = getActiveConsumer()) == null ? void 0 : _a3.wrapper;
    }
    subtle2.currentComputed = currentComputed;
    subtle2.watched = /* @__PURE__ */ Symbol("watched");
    subtle2.unwatched = /* @__PURE__ */ Symbol("unwatched");
  })(Signal2.subtle || (Signal2.subtle = {}));
})(Signal || (Signal = {}));

// node_modules/signal-utils/dist/-private/util.ts.js
var createStorage = (initial = null) => new Signal.State(initial, {
  equals: () => false
});

// node_modules/signal-utils/dist/array.ts.js
var ARRAY_GETTER_METHODS = /* @__PURE__ */ new Set([Symbol.iterator, "concat", "entries", "every", "filter", "find", "findIndex", "flat", "flatMap", "forEach", "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "reduce", "reduceRight", "slice", "some", "values"]);
var ARRAY_WRITE_THEN_READ_METHODS = /* @__PURE__ */ new Set(["fill", "push", "unshift"]);
function convertToInt(prop) {
  if (typeof prop === "symbol") return null;
  const num = Number(prop);
  if (isNaN(num)) return null;
  return num % 1 === 0 ? num : null;
}
var SignalArray = class _SignalArray {
  /**
   * Creates an array from an iterable object.
   * @param iterable An iterable object to convert to an array.
   */
  /**
   * Creates an array from an iterable object.
   * @param iterable An iterable object to convert to an array.
   * @param mapfn A mapping function to call on every element of the array.
   * @param thisArg Value of 'this' used to invoke the mapfn.
   */
  static from(iterable, mapfn, thisArg) {
    return mapfn ? new _SignalArray(Array.from(iterable, mapfn, thisArg)) : new _SignalArray(Array.from(iterable));
  }
  static of(...arr) {
    return new _SignalArray(arr);
  }
  constructor(arr = []) {
    let clone = arr.slice();
    let self = this;
    let boundFns = /* @__PURE__ */ new Map();
    let nativelyAccessingLengthFromPushOrUnshift = false;
    return new Proxy(clone, {
      get(target, prop) {
        let index = convertToInt(prop);
        if (index !== null) {
          self.#readStorageFor(index);
          self.#collection.get();
          return target[index];
        }
        if (prop === "length") {
          if (nativelyAccessingLengthFromPushOrUnshift) {
            nativelyAccessingLengthFromPushOrUnshift = false;
          } else {
            self.#collection.get();
          }
          return target[prop];
        }
        if (ARRAY_WRITE_THEN_READ_METHODS.has(prop)) {
          nativelyAccessingLengthFromPushOrUnshift = true;
        }
        if (ARRAY_GETTER_METHODS.has(prop)) {
          let fn = boundFns.get(prop);
          if (fn === void 0) {
            fn = (...args) => {
              self.#collection.get();
              return target[prop](...args);
            };
            boundFns.set(prop, fn);
          }
          return fn;
        }
        return target[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        let index = convertToInt(prop);
        if (index !== null) {
          self.#dirtyStorageFor(index);
          self.#collection.set(null);
        } else if (prop === "length") {
          self.#collection.set(null);
        }
        return true;
      },
      getPrototypeOf() {
        return _SignalArray.prototype;
      }
    });
  }
  #collection = createStorage();
  #storages = /* @__PURE__ */ new Map();
  #readStorageFor(index) {
    let storage = this.#storages.get(index);
    if (storage === void 0) {
      storage = createStorage();
      this.#storages.set(index, storage);
    }
    storage.get();
  }
  #dirtyStorageFor(index) {
    const storage = this.#storages.get(index);
    if (storage) {
      storage.set(null);
    }
  }
};
Object.setPrototypeOf(SignalArray.prototype, Array.prototype);

// node_modules/signal-utils/dist/map.ts.js
var SignalMap = class {
  collection = createStorage();
  storages = /* @__PURE__ */ new Map();
  vals;
  readStorageFor(key) {
    const {
      storages
    } = this;
    let storage = storages.get(key);
    if (storage === void 0) {
      storage = createStorage();
      storages.set(key, storage);
    }
    storage.get();
  }
  dirtyStorageFor(key) {
    const storage = this.storages.get(key);
    if (storage) {
      storage.set(null);
    }
  }
  constructor(existing) {
    this.vals = existing ? new Map(existing) : /* @__PURE__ */ new Map();
  }
  // **** KEY GETTERS ****
  get(key) {
    this.readStorageFor(key);
    return this.vals.get(key);
  }
  has(key) {
    this.readStorageFor(key);
    return this.vals.has(key);
  }
  // **** ALL GETTERS ****
  entries() {
    this.collection.get();
    return this.vals.entries();
  }
  keys() {
    this.collection.get();
    return this.vals.keys();
  }
  values() {
    this.collection.get();
    return this.vals.values();
  }
  forEach(fn) {
    this.collection.get();
    this.vals.forEach(fn);
  }
  get size() {
    this.collection.get();
    return this.vals.size;
  }
  [Symbol.iterator]() {
    this.collection.get();
    return this.vals[Symbol.iterator]();
  }
  get [Symbol.toStringTag]() {
    return this.vals[Symbol.toStringTag];
  }
  // **** KEY SETTERS ****
  set(key, value) {
    this.dirtyStorageFor(key);
    this.collection.set(null);
    this.vals.set(key, value);
    return this;
  }
  delete(key) {
    this.dirtyStorageFor(key);
    this.collection.set(null);
    return this.vals.delete(key);
  }
  // **** ALL SETTERS ****
  clear() {
    this.storages.forEach((s) => s.set(null));
    this.collection.set(null);
    this.vals.clear();
  }
};
Object.setPrototypeOf(SignalMap.prototype, Map.prototype);

// node_modules/signal-utils/dist/object.ts.js
var SignalObjectImpl = class _SignalObjectImpl {
  static fromEntries(entries) {
    return new _SignalObjectImpl(Object.fromEntries(entries));
  }
  #storages = /* @__PURE__ */ new Map();
  #collection = createStorage();
  constructor(obj = {}) {
    let proto = Object.getPrototypeOf(obj);
    let descs = Object.getOwnPropertyDescriptors(obj);
    let clone = Object.create(proto);
    for (let prop in descs) {
      Object.defineProperty(clone, prop, descs[prop]);
    }
    let self = this;
    return new Proxy(clone, {
      get(target, prop, receiver) {
        self.#readStorageFor(prop);
        return Reflect.get(target, prop, receiver);
      },
      has(target, prop) {
        self.#readStorageFor(prop);
        return prop in target;
      },
      ownKeys(target) {
        self.#collection.get();
        return Reflect.ownKeys(target);
      },
      set(target, prop, value, receiver) {
        let result = Reflect.set(target, prop, value, receiver);
        self.#dirtyStorageFor(prop);
        self.#dirtyCollection();
        return result;
      },
      deleteProperty(target, prop) {
        if (prop in target) {
          delete target[prop];
          self.#dirtyStorageFor(prop);
          self.#dirtyCollection();
        }
        return true;
      },
      getPrototypeOf() {
        return _SignalObjectImpl.prototype;
      }
    });
  }
  #readStorageFor(key) {
    let storage = this.#storages.get(key);
    if (storage === void 0) {
      storage = createStorage();
      this.#storages.set(key, storage);
    }
    storage.get();
  }
  #dirtyStorageFor(key) {
    const storage = this.#storages.get(key);
    if (storage) {
      storage.set(null);
    }
  }
  #dirtyCollection() {
    this.#collection.set(null);
  }
};
var SignalObject = SignalObjectImpl;

// node_modules/signal-utils/dist/set.ts.js
var SignalSet = class {
  collection = createStorage();
  storages = /* @__PURE__ */ new Map();
  vals;
  storageFor(key) {
    const storages = this.storages;
    let storage = storages.get(key);
    if (storage === void 0) {
      storage = createStorage();
      storages.set(key, storage);
    }
    return storage;
  }
  dirtyStorageFor(key) {
    const storage = this.storages.get(key);
    if (storage) {
      storage.set(null);
    }
  }
  constructor(existing) {
    this.vals = new Set(existing);
  }
  // **** KEY GETTERS ****
  has(value) {
    this.storageFor(value).get();
    return this.vals.has(value);
  }
  // **** ALL GETTERS ****
  entries() {
    this.collection.get();
    return this.vals.entries();
  }
  keys() {
    this.collection.get();
    return this.vals.keys();
  }
  values() {
    this.collection.get();
    return this.vals.values();
  }
  forEach(fn) {
    this.collection.get();
    this.vals.forEach(fn);
  }
  get size() {
    this.collection.get();
    return this.vals.size;
  }
  [Symbol.iterator]() {
    this.collection.get();
    return this.vals[Symbol.iterator]();
  }
  get [Symbol.toStringTag]() {
    return this.vals[Symbol.toStringTag];
  }
  // **** KEY SETTERS ****
  add(value) {
    this.dirtyStorageFor(value);
    this.collection.set(null);
    this.vals.add(value);
    return this;
  }
  delete(value) {
    this.dirtyStorageFor(value);
    this.collection.set(null);
    return this.vals.delete(value);
  }
  // **** ALL SETTERS ****
  clear() {
    this.storages.forEach((s) => s.set(null));
    this.collection.set(null);
    this.vals.clear();
  }
};
Object.setPrototypeOf(SignalSet.prototype, Set.prototype);

// node_modules/@a2ui/lit/src/0.8/data/signal-model-processor.js
function create() {
  return new A2uiMessageProcessor({
    arrayCtor: SignalArray,
    mapCtor: SignalMap,
    objCtor: SignalObject,
    setCtor: SignalSet
  });
}

// node_modules/@a2ui/lit/src/0.8/core.js
var Data = {
  createSignalA2uiMessageProcessor: create,
  A2uiMessageProcessor,
  Guards: guards_exports
};

export {
  events_exports,
  types_exports,
  guards_exports,
  A2uiMessageProcessor,
  primitives_exports,
  styles_exports,
  events_exports2,
  Schemas,
  Data
};
//# sourceMappingURL=chunk-PEEADQSW.js.map
