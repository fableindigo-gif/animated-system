import {
  outputFromObservable,
  takeUntilDestroyed,
  toObservable,
  toSignal
} from "./chunk-2UXOOXL4.js";
import {
  AsyncPipe,
  KeyValuePipe,
  NgComponentOutlet,
  NgTemplateOutlet
} from "./chunk-Y6THCRK5.js";
import "./chunk-TREOF22W.js";
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  HostListener,
  Injectable,
  Input,
  Renderer2,
  TemplateRef,
  contentChild,
  input,
  output,
  setClassMetadata,
  viewChild,
  ɵɵHostDirectivesFeature,
  ɵɵInheritDefinitionFeature,
  ɵɵProvidersFeature,
  ɵɵadvance,
  ɵɵattribute,
  ɵɵclassProp,
  ɵɵcomponentInstance,
  ɵɵconditional,
  ɵɵconditionalCreate,
  ɵɵcontentQuerySignal,
  ɵɵdefineComponent,
  ɵɵdefineDirective,
  ɵɵdomElement,
  ɵɵdomElementEnd,
  ɵɵdomElementStart,
  ɵɵelement,
  ɵɵelementContainer,
  ɵɵelementContainerEnd,
  ɵɵelementContainerStart,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵgetInheritedFactory,
  ɵɵlistener,
  ɵɵnextContext,
  ɵɵpipe,
  ɵɵpipeBind1,
  ɵɵprojection,
  ɵɵprojectionDef,
  ɵɵproperty,
  ɵɵqueryAdvance,
  ɵɵrepeater,
  ɵɵrepeaterCreate,
  ɵɵrepeaterTrackByIdentity,
  ɵɵrepeaterTrackByIndex,
  ɵɵresolveDocument,
  ɵɵsanitizeHtml,
  ɵɵstyleMap,
  ɵɵstyleProp,
  ɵɵtemplate,
  ɵɵtemplateRefExtractor,
  ɵɵtext,
  ɵɵtextInterpolate1,
  ɵɵviewQuerySignal
} from "./chunk-A2DGQQFJ.js";
import {
  DestroyRef,
  EventEmitter,
  Injector,
  NgZone,
  OutputEmitterRef,
  assertInInjectionContext,
  computed,
  effect,
  forwardRef,
  inject,
  runInInjectionContext,
  signal,
  untracked,
  ɵɵdefineInjectable,
  ɵɵnamespaceHTML,
  ɵɵnamespaceSVG,
  ɵɵresetView,
  ɵɵrestoreView
} from "./chunk-ZIK34A2Q.js";
import {
  animationFrameScheduler,
  fromEvent,
  merge
} from "./chunk-SN3C37HS.js";
import "./chunk-IYAMKWW5.js";
import {
  asyncScheduler,
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  observeOn,
  of,
  pairwise,
  share,
  shareReplay,
  skip,
  startWith,
  switchMap,
  tap,
  zip
} from "./chunk-QZRS5QDR.js";
import {
  Observable,
  Subject,
  __decorate
} from "./chunk-YSYTNXRR.js";
import {
  __async,
  __spreadProps,
  __spreadValues
} from "./chunk-IZIF4DQH.js";

// node_modules/d3-selection/src/namespaces.js
var xhtml = "http://www.w3.org/1999/xhtml";
var namespaces_default = {
  svg: "http://www.w3.org/2000/svg",
  xhtml,
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace",
  xmlns: "http://www.w3.org/2000/xmlns/"
};

// node_modules/d3-selection/src/namespace.js
function namespace_default(name) {
  var prefix = name += "", i = prefix.indexOf(":");
  if (i >= 0 && (prefix = name.slice(0, i)) !== "xmlns") name = name.slice(i + 1);
  return namespaces_default.hasOwnProperty(prefix) ? { space: namespaces_default[prefix], local: name } : name;
}

// node_modules/d3-selection/src/creator.js
function creatorInherit(name) {
  return function() {
    var document2 = this.ownerDocument, uri = this.namespaceURI;
    return uri === xhtml && document2.documentElement.namespaceURI === xhtml ? document2.createElement(name) : document2.createElementNS(uri, name);
  };
}
function creatorFixed(fullname) {
  return function() {
    return this.ownerDocument.createElementNS(fullname.space, fullname.local);
  };
}
function creator_default(name) {
  var fullname = namespace_default(name);
  return (fullname.local ? creatorFixed : creatorInherit)(fullname);
}

// node_modules/d3-selection/src/selector.js
function none() {
}
function selector_default(selector) {
  return selector == null ? none : function() {
    return this.querySelector(selector);
  };
}

// node_modules/d3-selection/src/selection/select.js
function select_default(select) {
  if (typeof select !== "function") select = selector_default(select);
  for (var groups = this._groups, m = groups.length, subgroups = new Array(m), j = 0; j < m; ++j) {
    for (var group = groups[j], n = group.length, subgroup = subgroups[j] = new Array(n), node, subnode, i = 0; i < n; ++i) {
      if ((node = group[i]) && (subnode = select.call(node, node.__data__, i, group))) {
        if ("__data__" in node) subnode.__data__ = node.__data__;
        subgroup[i] = subnode;
      }
    }
  }
  return new Selection(subgroups, this._parents);
}

// node_modules/d3-selection/src/array.js
function array(x) {
  return x == null ? [] : Array.isArray(x) ? x : Array.from(x);
}

// node_modules/d3-selection/src/selectorAll.js
function empty() {
  return [];
}
function selectorAll_default(selector) {
  return selector == null ? empty : function() {
    return this.querySelectorAll(selector);
  };
}

// node_modules/d3-selection/src/selection/selectAll.js
function arrayAll(select) {
  return function() {
    return array(select.apply(this, arguments));
  };
}
function selectAll_default(select) {
  if (typeof select === "function") select = arrayAll(select);
  else select = selectorAll_default(select);
  for (var groups = this._groups, m = groups.length, subgroups = [], parents = [], j = 0; j < m; ++j) {
    for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
      if (node = group[i]) {
        subgroups.push(select.call(node, node.__data__, i, group));
        parents.push(node);
      }
    }
  }
  return new Selection(subgroups, parents);
}

// node_modules/d3-selection/src/matcher.js
function matcher_default(selector) {
  return function() {
    return this.matches(selector);
  };
}
function childMatcher(selector) {
  return function(node) {
    return node.matches(selector);
  };
}

// node_modules/d3-selection/src/selection/selectChild.js
var find = Array.prototype.find;
function childFind(match) {
  return function() {
    return find.call(this.children, match);
  };
}
function childFirst() {
  return this.firstElementChild;
}
function selectChild_default(match) {
  return this.select(match == null ? childFirst : childFind(typeof match === "function" ? match : childMatcher(match)));
}

// node_modules/d3-selection/src/selection/selectChildren.js
var filter2 = Array.prototype.filter;
function children() {
  return Array.from(this.children);
}
function childrenFilter(match) {
  return function() {
    return filter2.call(this.children, match);
  };
}
function selectChildren_default(match) {
  return this.selectAll(match == null ? children : childrenFilter(typeof match === "function" ? match : childMatcher(match)));
}

// node_modules/d3-selection/src/selection/filter.js
function filter_default(match) {
  if (typeof match !== "function") match = matcher_default(match);
  for (var groups = this._groups, m = groups.length, subgroups = new Array(m), j = 0; j < m; ++j) {
    for (var group = groups[j], n = group.length, subgroup = subgroups[j] = [], node, i = 0; i < n; ++i) {
      if ((node = group[i]) && match.call(node, node.__data__, i, group)) {
        subgroup.push(node);
      }
    }
  }
  return new Selection(subgroups, this._parents);
}

// node_modules/d3-selection/src/selection/sparse.js
function sparse_default(update) {
  return new Array(update.length);
}

// node_modules/d3-selection/src/selection/enter.js
function enter_default() {
  return new Selection(this._enter || this._groups.map(sparse_default), this._parents);
}
function EnterNode(parent, datum2) {
  this.ownerDocument = parent.ownerDocument;
  this.namespaceURI = parent.namespaceURI;
  this._next = null;
  this._parent = parent;
  this.__data__ = datum2;
}
EnterNode.prototype = {
  constructor: EnterNode,
  appendChild: function(child) {
    return this._parent.insertBefore(child, this._next);
  },
  insertBefore: function(child, next) {
    return this._parent.insertBefore(child, next);
  },
  querySelector: function(selector) {
    return this._parent.querySelector(selector);
  },
  querySelectorAll: function(selector) {
    return this._parent.querySelectorAll(selector);
  }
};

// node_modules/d3-selection/src/constant.js
function constant_default(x) {
  return function() {
    return x;
  };
}

// node_modules/d3-selection/src/selection/data.js
function bindIndex(parent, group, enter, update, exit, data) {
  var i = 0, node, groupLength = group.length, dataLength = data.length;
  for (; i < dataLength; ++i) {
    if (node = group[i]) {
      node.__data__ = data[i];
      update[i] = node;
    } else {
      enter[i] = new EnterNode(parent, data[i]);
    }
  }
  for (; i < groupLength; ++i) {
    if (node = group[i]) {
      exit[i] = node;
    }
  }
}
function bindKey(parent, group, enter, update, exit, data, key) {
  var i, node, nodeByKeyValue = /* @__PURE__ */ new Map(), groupLength = group.length, dataLength = data.length, keyValues = new Array(groupLength), keyValue;
  for (i = 0; i < groupLength; ++i) {
    if (node = group[i]) {
      keyValues[i] = keyValue = key.call(node, node.__data__, i, group) + "";
      if (nodeByKeyValue.has(keyValue)) {
        exit[i] = node;
      } else {
        nodeByKeyValue.set(keyValue, node);
      }
    }
  }
  for (i = 0; i < dataLength; ++i) {
    keyValue = key.call(parent, data[i], i, data) + "";
    if (node = nodeByKeyValue.get(keyValue)) {
      update[i] = node;
      node.__data__ = data[i];
      nodeByKeyValue.delete(keyValue);
    } else {
      enter[i] = new EnterNode(parent, data[i]);
    }
  }
  for (i = 0; i < groupLength; ++i) {
    if ((node = group[i]) && nodeByKeyValue.get(keyValues[i]) === node) {
      exit[i] = node;
    }
  }
}
function datum(node) {
  return node.__data__;
}
function data_default(value, key) {
  if (!arguments.length) return Array.from(this, datum);
  var bind = key ? bindKey : bindIndex, parents = this._parents, groups = this._groups;
  if (typeof value !== "function") value = constant_default(value);
  for (var m = groups.length, update = new Array(m), enter = new Array(m), exit = new Array(m), j = 0; j < m; ++j) {
    var parent = parents[j], group = groups[j], groupLength = group.length, data = arraylike(value.call(parent, parent && parent.__data__, j, parents)), dataLength = data.length, enterGroup = enter[j] = new Array(dataLength), updateGroup = update[j] = new Array(dataLength), exitGroup = exit[j] = new Array(groupLength);
    bind(parent, group, enterGroup, updateGroup, exitGroup, data, key);
    for (var i0 = 0, i1 = 0, previous, next; i0 < dataLength; ++i0) {
      if (previous = enterGroup[i0]) {
        if (i0 >= i1) i1 = i0 + 1;
        while (!(next = updateGroup[i1]) && ++i1 < dataLength) ;
        previous._next = next || null;
      }
    }
  }
  update = new Selection(update, parents);
  update._enter = enter;
  update._exit = exit;
  return update;
}
function arraylike(data) {
  return typeof data === "object" && "length" in data ? data : Array.from(data);
}

// node_modules/d3-selection/src/selection/exit.js
function exit_default() {
  return new Selection(this._exit || this._groups.map(sparse_default), this._parents);
}

// node_modules/d3-selection/src/selection/join.js
function join_default(onenter, onupdate, onexit) {
  var enter = this.enter(), update = this, exit = this.exit();
  if (typeof onenter === "function") {
    enter = onenter(enter);
    if (enter) enter = enter.selection();
  } else {
    enter = enter.append(onenter + "");
  }
  if (onupdate != null) {
    update = onupdate(update);
    if (update) update = update.selection();
  }
  if (onexit == null) exit.remove();
  else onexit(exit);
  return enter && update ? enter.merge(update).order() : update;
}

// node_modules/d3-selection/src/selection/merge.js
function merge_default(context) {
  var selection2 = context.selection ? context.selection() : context;
  for (var groups0 = this._groups, groups1 = selection2._groups, m0 = groups0.length, m1 = groups1.length, m = Math.min(m0, m1), merges = new Array(m0), j = 0; j < m; ++j) {
    for (var group0 = groups0[j], group1 = groups1[j], n = group0.length, merge2 = merges[j] = new Array(n), node, i = 0; i < n; ++i) {
      if (node = group0[i] || group1[i]) {
        merge2[i] = node;
      }
    }
  }
  for (; j < m0; ++j) {
    merges[j] = groups0[j];
  }
  return new Selection(merges, this._parents);
}

// node_modules/d3-selection/src/selection/order.js
function order_default() {
  for (var groups = this._groups, j = -1, m = groups.length; ++j < m; ) {
    for (var group = groups[j], i = group.length - 1, next = group[i], node; --i >= 0; ) {
      if (node = group[i]) {
        if (next && node.compareDocumentPosition(next) ^ 4) next.parentNode.insertBefore(node, next);
        next = node;
      }
    }
  }
  return this;
}

// node_modules/d3-selection/src/selection/sort.js
function sort_default(compare) {
  if (!compare) compare = ascending;
  function compareNode(a, b) {
    return a && b ? compare(a.__data__, b.__data__) : !a - !b;
  }
  for (var groups = this._groups, m = groups.length, sortgroups = new Array(m), j = 0; j < m; ++j) {
    for (var group = groups[j], n = group.length, sortgroup = sortgroups[j] = new Array(n), node, i = 0; i < n; ++i) {
      if (node = group[i]) {
        sortgroup[i] = node;
      }
    }
    sortgroup.sort(compareNode);
  }
  return new Selection(sortgroups, this._parents).order();
}
function ascending(a, b) {
  return a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
}

// node_modules/d3-selection/src/selection/call.js
function call_default() {
  var callback = arguments[0];
  arguments[0] = this;
  callback.apply(null, arguments);
  return this;
}

// node_modules/d3-selection/src/selection/nodes.js
function nodes_default() {
  return Array.from(this);
}

// node_modules/d3-selection/src/selection/node.js
function node_default() {
  for (var groups = this._groups, j = 0, m = groups.length; j < m; ++j) {
    for (var group = groups[j], i = 0, n = group.length; i < n; ++i) {
      var node = group[i];
      if (node) return node;
    }
  }
  return null;
}

// node_modules/d3-selection/src/selection/size.js
function size_default() {
  let size = 0;
  for (const node of this) ++size;
  return size;
}

// node_modules/d3-selection/src/selection/empty.js
function empty_default() {
  return !this.node();
}

// node_modules/d3-selection/src/selection/each.js
function each_default(callback) {
  for (var groups = this._groups, j = 0, m = groups.length; j < m; ++j) {
    for (var group = groups[j], i = 0, n = group.length, node; i < n; ++i) {
      if (node = group[i]) callback.call(node, node.__data__, i, group);
    }
  }
  return this;
}

// node_modules/d3-selection/src/selection/attr.js
function attrRemove(name) {
  return function() {
    this.removeAttribute(name);
  };
}
function attrRemoveNS(fullname) {
  return function() {
    this.removeAttributeNS(fullname.space, fullname.local);
  };
}
function attrConstant(name, value) {
  return function() {
    this.setAttribute(name, value);
  };
}
function attrConstantNS(fullname, value) {
  return function() {
    this.setAttributeNS(fullname.space, fullname.local, value);
  };
}
function attrFunction(name, value) {
  return function() {
    var v = value.apply(this, arguments);
    if (v == null) this.removeAttribute(name);
    else this.setAttribute(name, v);
  };
}
function attrFunctionNS(fullname, value) {
  return function() {
    var v = value.apply(this, arguments);
    if (v == null) this.removeAttributeNS(fullname.space, fullname.local);
    else this.setAttributeNS(fullname.space, fullname.local, v);
  };
}
function attr_default(name, value) {
  var fullname = namespace_default(name);
  if (arguments.length < 2) {
    var node = this.node();
    return fullname.local ? node.getAttributeNS(fullname.space, fullname.local) : node.getAttribute(fullname);
  }
  return this.each((value == null ? fullname.local ? attrRemoveNS : attrRemove : typeof value === "function" ? fullname.local ? attrFunctionNS : attrFunction : fullname.local ? attrConstantNS : attrConstant)(fullname, value));
}

// node_modules/d3-selection/src/window.js
function window_default(node) {
  return node.ownerDocument && node.ownerDocument.defaultView || node.document && node || node.defaultView;
}

// node_modules/d3-selection/src/selection/style.js
function styleRemove(name) {
  return function() {
    this.style.removeProperty(name);
  };
}
function styleConstant(name, value, priority) {
  return function() {
    this.style.setProperty(name, value, priority);
  };
}
function styleFunction(name, value, priority) {
  return function() {
    var v = value.apply(this, arguments);
    if (v == null) this.style.removeProperty(name);
    else this.style.setProperty(name, v, priority);
  };
}
function style_default(name, value, priority) {
  return arguments.length > 1 ? this.each((value == null ? styleRemove : typeof value === "function" ? styleFunction : styleConstant)(name, value, priority == null ? "" : priority)) : styleValue(this.node(), name);
}
function styleValue(node, name) {
  return node.style.getPropertyValue(name) || window_default(node).getComputedStyle(node, null).getPropertyValue(name);
}

// node_modules/d3-selection/src/selection/property.js
function propertyRemove(name) {
  return function() {
    delete this[name];
  };
}
function propertyConstant(name, value) {
  return function() {
    this[name] = value;
  };
}
function propertyFunction(name, value) {
  return function() {
    var v = value.apply(this, arguments);
    if (v == null) delete this[name];
    else this[name] = v;
  };
}
function property_default(name, value) {
  return arguments.length > 1 ? this.each((value == null ? propertyRemove : typeof value === "function" ? propertyFunction : propertyConstant)(name, value)) : this.node()[name];
}

// node_modules/d3-selection/src/selection/classed.js
function classArray(string) {
  return string.trim().split(/^|\s+/);
}
function classList(node) {
  return node.classList || new ClassList(node);
}
function ClassList(node) {
  this._node = node;
  this._names = classArray(node.getAttribute("class") || "");
}
ClassList.prototype = {
  add: function(name) {
    var i = this._names.indexOf(name);
    if (i < 0) {
      this._names.push(name);
      this._node.setAttribute("class", this._names.join(" "));
    }
  },
  remove: function(name) {
    var i = this._names.indexOf(name);
    if (i >= 0) {
      this._names.splice(i, 1);
      this._node.setAttribute("class", this._names.join(" "));
    }
  },
  contains: function(name) {
    return this._names.indexOf(name) >= 0;
  }
};
function classedAdd(node, names) {
  var list = classList(node), i = -1, n = names.length;
  while (++i < n) list.add(names[i]);
}
function classedRemove(node, names) {
  var list = classList(node), i = -1, n = names.length;
  while (++i < n) list.remove(names[i]);
}
function classedTrue(names) {
  return function() {
    classedAdd(this, names);
  };
}
function classedFalse(names) {
  return function() {
    classedRemove(this, names);
  };
}
function classedFunction(names, value) {
  return function() {
    (value.apply(this, arguments) ? classedAdd : classedRemove)(this, names);
  };
}
function classed_default(name, value) {
  var names = classArray(name + "");
  if (arguments.length < 2) {
    var list = classList(this.node()), i = -1, n = names.length;
    while (++i < n) if (!list.contains(names[i])) return false;
    return true;
  }
  return this.each((typeof value === "function" ? classedFunction : value ? classedTrue : classedFalse)(names, value));
}

// node_modules/d3-selection/src/selection/text.js
function textRemove() {
  this.textContent = "";
}
function textConstant(value) {
  return function() {
    this.textContent = value;
  };
}
function textFunction(value) {
  return function() {
    var v = value.apply(this, arguments);
    this.textContent = v == null ? "" : v;
  };
}
function text_default(value) {
  return arguments.length ? this.each(value == null ? textRemove : (typeof value === "function" ? textFunction : textConstant)(value)) : this.node().textContent;
}

// node_modules/d3-selection/src/selection/html.js
function htmlRemove() {
  this.innerHTML = "";
}
function htmlConstant(value) {
  return function() {
    this.innerHTML = value;
  };
}
function htmlFunction(value) {
  return function() {
    var v = value.apply(this, arguments);
    this.innerHTML = v == null ? "" : v;
  };
}
function html_default(value) {
  return arguments.length ? this.each(value == null ? htmlRemove : (typeof value === "function" ? htmlFunction : htmlConstant)(value)) : this.node().innerHTML;
}

// node_modules/d3-selection/src/selection/raise.js
function raise() {
  if (this.nextSibling) this.parentNode.appendChild(this);
}
function raise_default() {
  return this.each(raise);
}

// node_modules/d3-selection/src/selection/lower.js
function lower() {
  if (this.previousSibling) this.parentNode.insertBefore(this, this.parentNode.firstChild);
}
function lower_default() {
  return this.each(lower);
}

// node_modules/d3-selection/src/selection/append.js
function append_default(name) {
  var create2 = typeof name === "function" ? name : creator_default(name);
  return this.select(function() {
    return this.appendChild(create2.apply(this, arguments));
  });
}

// node_modules/d3-selection/src/selection/insert.js
function constantNull() {
  return null;
}
function insert_default(name, before) {
  var create2 = typeof name === "function" ? name : creator_default(name), select = before == null ? constantNull : typeof before === "function" ? before : selector_default(before);
  return this.select(function() {
    return this.insertBefore(create2.apply(this, arguments), select.apply(this, arguments) || null);
  });
}

// node_modules/d3-selection/src/selection/remove.js
function remove() {
  var parent = this.parentNode;
  if (parent) parent.removeChild(this);
}
function remove_default() {
  return this.each(remove);
}

// node_modules/d3-selection/src/selection/clone.js
function selection_cloneShallow() {
  var clone = this.cloneNode(false), parent = this.parentNode;
  return parent ? parent.insertBefore(clone, this.nextSibling) : clone;
}
function selection_cloneDeep() {
  var clone = this.cloneNode(true), parent = this.parentNode;
  return parent ? parent.insertBefore(clone, this.nextSibling) : clone;
}
function clone_default(deep) {
  return this.select(deep ? selection_cloneDeep : selection_cloneShallow);
}

// node_modules/d3-selection/src/selection/datum.js
function datum_default(value) {
  return arguments.length ? this.property("__data__", value) : this.node().__data__;
}

// node_modules/d3-selection/src/selection/on.js
function contextListener(listener) {
  return function(event) {
    listener.call(this, event, this.__data__);
  };
}
function parseTypenames(typenames) {
  return typenames.trim().split(/^|\s+/).map(function(t) {
    var name = "", i = t.indexOf(".");
    if (i >= 0) name = t.slice(i + 1), t = t.slice(0, i);
    return { type: t, name };
  });
}
function onRemove(typename) {
  return function() {
    var on = this.__on;
    if (!on) return;
    for (var j = 0, i = -1, m = on.length, o; j < m; ++j) {
      if (o = on[j], (!typename.type || o.type === typename.type) && o.name === typename.name) {
        this.removeEventListener(o.type, o.listener, o.options);
      } else {
        on[++i] = o;
      }
    }
    if (++i) on.length = i;
    else delete this.__on;
  };
}
function onAdd(typename, value, options) {
  return function() {
    var on = this.__on, o, listener = contextListener(value);
    if (on) for (var j = 0, m = on.length; j < m; ++j) {
      if ((o = on[j]).type === typename.type && o.name === typename.name) {
        this.removeEventListener(o.type, o.listener, o.options);
        this.addEventListener(o.type, o.listener = listener, o.options = options);
        o.value = value;
        return;
      }
    }
    this.addEventListener(typename.type, listener, options);
    o = { type: typename.type, name: typename.name, value, listener, options };
    if (!on) this.__on = [o];
    else on.push(o);
  };
}
function on_default(typename, value, options) {
  var typenames = parseTypenames(typename + ""), i, n = typenames.length, t;
  if (arguments.length < 2) {
    var on = this.node().__on;
    if (on) for (var j = 0, m = on.length, o; j < m; ++j) {
      for (i = 0, o = on[j]; i < n; ++i) {
        if ((t = typenames[i]).type === o.type && t.name === o.name) {
          return o.value;
        }
      }
    }
    return;
  }
  on = value ? onAdd : onRemove;
  for (i = 0; i < n; ++i) this.each(on(typenames[i], value, options));
  return this;
}

// node_modules/d3-selection/src/selection/dispatch.js
function dispatchEvent(node, type, params) {
  var window2 = window_default(node), event = window2.CustomEvent;
  if (typeof event === "function") {
    event = new event(type, params);
  } else {
    event = window2.document.createEvent("Event");
    if (params) event.initEvent(type, params.bubbles, params.cancelable), event.detail = params.detail;
    else event.initEvent(type, false, false);
  }
  node.dispatchEvent(event);
}
function dispatchConstant(type, params) {
  return function() {
    return dispatchEvent(this, type, params);
  };
}
function dispatchFunction(type, params) {
  return function() {
    return dispatchEvent(this, type, params.apply(this, arguments));
  };
}
function dispatch_default(type, params) {
  return this.each((typeof params === "function" ? dispatchFunction : dispatchConstant)(type, params));
}

// node_modules/d3-selection/src/selection/iterator.js
function* iterator_default() {
  for (var groups = this._groups, j = 0, m = groups.length; j < m; ++j) {
    for (var group = groups[j], i = 0, n = group.length, node; i < n; ++i) {
      if (node = group[i]) yield node;
    }
  }
}

// node_modules/d3-selection/src/selection/index.js
var root = [null];
function Selection(groups, parents) {
  this._groups = groups;
  this._parents = parents;
}
function selection() {
  return new Selection([[document.documentElement]], root);
}
function selection_selection() {
  return this;
}
Selection.prototype = selection.prototype = {
  constructor: Selection,
  select: select_default,
  selectAll: selectAll_default,
  selectChild: selectChild_default,
  selectChildren: selectChildren_default,
  filter: filter_default,
  data: data_default,
  enter: enter_default,
  exit: exit_default,
  join: join_default,
  merge: merge_default,
  selection: selection_selection,
  order: order_default,
  sort: sort_default,
  call: call_default,
  nodes: nodes_default,
  node: node_default,
  size: size_default,
  empty: empty_default,
  each: each_default,
  attr: attr_default,
  style: style_default,
  property: property_default,
  classed: classed_default,
  text: text_default,
  html: html_default,
  raise: raise_default,
  lower: lower_default,
  append: append_default,
  insert: insert_default,
  remove: remove_default,
  clone: clone_default,
  datum: datum_default,
  on: on_default,
  dispatch: dispatch_default,
  [Symbol.iterator]: iterator_default
};
var selection_default = selection;

// node_modules/d3-selection/src/select.js
function select_default2(selector) {
  return typeof selector === "string" ? new Selection([[document.querySelector(selector)]], [document.documentElement]) : new Selection([[selector]], root);
}

// node_modules/d3-selection/src/local.js
var nextId = 0;
function local() {
  return new Local();
}
function Local() {
  this._ = "@" + (++nextId).toString(36);
}
Local.prototype = local.prototype = {
  constructor: Local,
  get: function(node) {
    var id3 = this._;
    while (!(id3 in node)) if (!(node = node.parentNode)) return;
    return node[id3];
  },
  set: function(node, value) {
    return node[this._] = value;
  },
  remove: function(node) {
    return this._ in node && delete node[this._];
  },
  toString: function() {
    return this._;
  }
};

// node_modules/d3-selection/src/sourceEvent.js
function sourceEvent_default(event) {
  let sourceEvent;
  while (sourceEvent = event.sourceEvent) event = sourceEvent;
  return event;
}

// node_modules/d3-selection/src/pointer.js
function pointer_default(event, node) {
  event = sourceEvent_default(event);
  if (node === void 0) node = event.currentTarget;
  if (node) {
    var svg = node.ownerSVGElement || node;
    if (svg.createSVGPoint) {
      var point = svg.createSVGPoint();
      point.x = event.clientX, point.y = event.clientY;
      point = point.matrixTransform(node.getScreenCTM().inverse());
      return [point.x, point.y];
    }
    if (node.getBoundingClientRect) {
      var rect = node.getBoundingClientRect();
      return [event.clientX - rect.left - node.clientLeft, event.clientY - rect.top - node.clientTop];
    }
  }
  return [event.pageX, event.pageY];
}

// node_modules/d3-dispatch/src/dispatch.js
var noop = { value: () => {
} };
function dispatch() {
  for (var i = 0, n = arguments.length, _ = {}, t; i < n; ++i) {
    if (!(t = arguments[i] + "") || t in _ || /[\s.]/.test(t)) throw new Error("illegal type: " + t);
    _[t] = [];
  }
  return new Dispatch(_);
}
function Dispatch(_) {
  this._ = _;
}
function parseTypenames2(typenames, types) {
  return typenames.trim().split(/^|\s+/).map(function(t) {
    var name = "", i = t.indexOf(".");
    if (i >= 0) name = t.slice(i + 1), t = t.slice(0, i);
    if (t && !types.hasOwnProperty(t)) throw new Error("unknown type: " + t);
    return { type: t, name };
  });
}
Dispatch.prototype = dispatch.prototype = {
  constructor: Dispatch,
  on: function(typename, callback) {
    var _ = this._, T = parseTypenames2(typename + "", _), t, i = -1, n = T.length;
    if (arguments.length < 2) {
      while (++i < n) if ((t = (typename = T[i]).type) && (t = get(_[t], typename.name))) return t;
      return;
    }
    if (callback != null && typeof callback !== "function") throw new Error("invalid callback: " + callback);
    while (++i < n) {
      if (t = (typename = T[i]).type) _[t] = set(_[t], typename.name, callback);
      else if (callback == null) for (t in _) _[t] = set(_[t], typename.name, null);
    }
    return this;
  },
  copy: function() {
    var copy = {}, _ = this._;
    for (var t in _) copy[t] = _[t].slice();
    return new Dispatch(copy);
  },
  call: function(type, that) {
    if ((n = arguments.length - 2) > 0) for (var args = new Array(n), i = 0, n, t; i < n; ++i) args[i] = arguments[i + 2];
    if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
    for (t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
  },
  apply: function(type, that, args) {
    if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
    for (var t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
  }
};
function get(type, name) {
  for (var i = 0, n = type.length, c; i < n; ++i) {
    if ((c = type[i]).name === name) {
      return c.value;
    }
  }
}
function set(type, name, callback) {
  for (var i = 0, n = type.length; i < n; ++i) {
    if (type[i].name === name) {
      type[i] = noop, type = type.slice(0, i).concat(type.slice(i + 1));
      break;
    }
  }
  if (callback != null) type.push({ name, value: callback });
  return type;
}
var dispatch_default2 = dispatch;

// node_modules/d3-drag/src/noevent.js
var nonpassive = { passive: false };
var nonpassivecapture = { capture: true, passive: false };
function nopropagation(event) {
  event.stopImmediatePropagation();
}
function noevent_default(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// node_modules/d3-drag/src/nodrag.js
function nodrag_default(view) {
  var root2 = view.document.documentElement, selection2 = select_default2(view).on("dragstart.drag", noevent_default, nonpassivecapture);
  if ("onselectstart" in root2) {
    selection2.on("selectstart.drag", noevent_default, nonpassivecapture);
  } else {
    root2.__noselect = root2.style.MozUserSelect;
    root2.style.MozUserSelect = "none";
  }
}
function yesdrag(view, noclick) {
  var root2 = view.document.documentElement, selection2 = select_default2(view).on("dragstart.drag", null);
  if (noclick) {
    selection2.on("click.drag", noevent_default, nonpassivecapture);
    setTimeout(function() {
      selection2.on("click.drag", null);
    }, 0);
  }
  if ("onselectstart" in root2) {
    selection2.on("selectstart.drag", null);
  } else {
    root2.style.MozUserSelect = root2.__noselect;
    delete root2.__noselect;
  }
}

// node_modules/d3-drag/src/constant.js
var constant_default2 = (x) => () => x;

// node_modules/d3-drag/src/event.js
function DragEvent(type, {
  sourceEvent,
  subject,
  target,
  identifier,
  active,
  x,
  y,
  dx,
  dy,
  dispatch: dispatch2
}) {
  Object.defineProperties(this, {
    type: { value: type, enumerable: true, configurable: true },
    sourceEvent: { value: sourceEvent, enumerable: true, configurable: true },
    subject: { value: subject, enumerable: true, configurable: true },
    target: { value: target, enumerable: true, configurable: true },
    identifier: { value: identifier, enumerable: true, configurable: true },
    active: { value: active, enumerable: true, configurable: true },
    x: { value: x, enumerable: true, configurable: true },
    y: { value: y, enumerable: true, configurable: true },
    dx: { value: dx, enumerable: true, configurable: true },
    dy: { value: dy, enumerable: true, configurable: true },
    _: { value: dispatch2 }
  });
}
DragEvent.prototype.on = function() {
  var value = this._.on.apply(this._, arguments);
  return value === this._ ? this : value;
};

// node_modules/d3-drag/src/drag.js
function defaultFilter(event) {
  return !event.ctrlKey && !event.button;
}
function defaultContainer() {
  return this.parentNode;
}
function defaultSubject(event, d) {
  return d == null ? { x: event.x, y: event.y } : d;
}
function defaultTouchable() {
  return navigator.maxTouchPoints || "ontouchstart" in this;
}
function drag_default() {
  var filter3 = defaultFilter, container = defaultContainer, subject = defaultSubject, touchable = defaultTouchable, gestures = {}, listeners = dispatch_default2("start", "drag", "end"), active = 0, mousedownx, mousedowny, mousemoving, touchending, clickDistance2 = 0;
  function drag(selection2) {
    selection2.on("mousedown.drag", mousedowned).filter(touchable).on("touchstart.drag", touchstarted).on("touchmove.drag", touchmoved, nonpassive).on("touchend.drag touchcancel.drag", touchended).style("touch-action", "none").style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }
  function mousedowned(event, d) {
    if (touchending || !filter3.call(this, event, d)) return;
    var gesture = beforestart(this, container.call(this, event, d), event, d, "mouse");
    if (!gesture) return;
    select_default2(event.view).on("mousemove.drag", mousemoved, nonpassivecapture).on("mouseup.drag", mouseupped, nonpassivecapture);
    nodrag_default(event.view);
    nopropagation(event);
    mousemoving = false;
    mousedownx = event.clientX;
    mousedowny = event.clientY;
    gesture("start", event);
  }
  function mousemoved(event) {
    noevent_default(event);
    if (!mousemoving) {
      var dx = event.clientX - mousedownx, dy = event.clientY - mousedowny;
      mousemoving = dx * dx + dy * dy > clickDistance2;
    }
    gestures.mouse("drag", event);
  }
  function mouseupped(event) {
    select_default2(event.view).on("mousemove.drag mouseup.drag", null);
    yesdrag(event.view, mousemoving);
    noevent_default(event);
    gestures.mouse("end", event);
  }
  function touchstarted(event, d) {
    if (!filter3.call(this, event, d)) return;
    var touches = event.changedTouches, c = container.call(this, event, d), n = touches.length, i, gesture;
    for (i = 0; i < n; ++i) {
      if (gesture = beforestart(this, c, event, d, touches[i].identifier, touches[i])) {
        nopropagation(event);
        gesture("start", event, touches[i]);
      }
    }
  }
  function touchmoved(event) {
    var touches = event.changedTouches, n = touches.length, i, gesture;
    for (i = 0; i < n; ++i) {
      if (gesture = gestures[touches[i].identifier]) {
        noevent_default(event);
        gesture("drag", event, touches[i]);
      }
    }
  }
  function touchended(event) {
    var touches = event.changedTouches, n = touches.length, i, gesture;
    if (touchending) clearTimeout(touchending);
    touchending = setTimeout(function() {
      touchending = null;
    }, 500);
    for (i = 0; i < n; ++i) {
      if (gesture = gestures[touches[i].identifier]) {
        nopropagation(event);
        gesture("end", event, touches[i]);
      }
    }
  }
  function beforestart(that, container2, event, d, identifier, touch) {
    var dispatch2 = listeners.copy(), p = pointer_default(touch || event, container2), dx, dy, s;
    if ((s = subject.call(that, new DragEvent("beforestart", {
      sourceEvent: event,
      target: drag,
      identifier,
      active,
      x: p[0],
      y: p[1],
      dx: 0,
      dy: 0,
      dispatch: dispatch2
    }), d)) == null) return;
    dx = s.x - p[0] || 0;
    dy = s.y - p[1] || 0;
    return function gesture(type, event2, touch2) {
      var p0 = p, n;
      switch (type) {
        case "start":
          gestures[identifier] = gesture, n = active++;
          break;
        case "end":
          delete gestures[identifier], --active;
        // falls through
        case "drag":
          p = pointer_default(touch2 || event2, container2), n = active;
          break;
      }
      dispatch2.call(
        type,
        that,
        new DragEvent(type, {
          sourceEvent: event2,
          subject: s,
          target: drag,
          identifier,
          active: n,
          x: p[0] + dx,
          y: p[1] + dy,
          dx: p[0] - p0[0],
          dy: p[1] - p0[1],
          dispatch: dispatch2
        }),
        d
      );
    };
  }
  drag.filter = function(_) {
    return arguments.length ? (filter3 = typeof _ === "function" ? _ : constant_default2(!!_), drag) : filter3;
  };
  drag.container = function(_) {
    return arguments.length ? (container = typeof _ === "function" ? _ : constant_default2(_), drag) : container;
  };
  drag.subject = function(_) {
    return arguments.length ? (subject = typeof _ === "function" ? _ : constant_default2(_), drag) : subject;
  };
  drag.touchable = function(_) {
    return arguments.length ? (touchable = typeof _ === "function" ? _ : constant_default2(!!_), drag) : touchable;
  };
  drag.on = function() {
    var value = listeners.on.apply(listeners, arguments);
    return value === listeners ? drag : value;
  };
  drag.clickDistance = function(_) {
    return arguments.length ? (clickDistance2 = (_ = +_) * _, drag) : Math.sqrt(clickDistance2);
  };
  return drag;
}

// node_modules/d3-color/src/define.js
function define_default(constructor, factory, prototype) {
  constructor.prototype = factory.prototype = prototype;
  prototype.constructor = constructor;
}
function extend(parent, definition) {
  var prototype = Object.create(parent.prototype);
  for (var key in definition) prototype[key] = definition[key];
  return prototype;
}

// node_modules/d3-color/src/color.js
function Color() {
}
var darker = 0.7;
var brighter = 1 / darker;
var reI = "\\s*([+-]?\\d+)\\s*";
var reN = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*";
var reP = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*";
var reHex = /^#([0-9a-f]{3,8})$/;
var reRgbInteger = new RegExp(`^rgb\\(${reI},${reI},${reI}\\)$`);
var reRgbPercent = new RegExp(`^rgb\\(${reP},${reP},${reP}\\)$`);
var reRgbaInteger = new RegExp(`^rgba\\(${reI},${reI},${reI},${reN}\\)$`);
var reRgbaPercent = new RegExp(`^rgba\\(${reP},${reP},${reP},${reN}\\)$`);
var reHslPercent = new RegExp(`^hsl\\(${reN},${reP},${reP}\\)$`);
var reHslaPercent = new RegExp(`^hsla\\(${reN},${reP},${reP},${reN}\\)$`);
var named = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkgrey: 11119017,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkslategrey: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgray: 6908265,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  rebeccapurple: 6697881,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategray: 7372944,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
};
define_default(Color, color, {
  copy(channels) {
    return Object.assign(new this.constructor(), this, channels);
  },
  displayable() {
    return this.rgb().displayable();
  },
  hex: color_formatHex,
  // Deprecated! Use color.formatHex.
  formatHex: color_formatHex,
  formatHex8: color_formatHex8,
  formatHsl: color_formatHsl,
  formatRgb: color_formatRgb,
  toString: color_formatRgb
});
function color_formatHex() {
  return this.rgb().formatHex();
}
function color_formatHex8() {
  return this.rgb().formatHex8();
}
function color_formatHsl() {
  return hslConvert(this).formatHsl();
}
function color_formatRgb() {
  return this.rgb().formatRgb();
}
function color(format) {
  var m, l;
  format = (format + "").trim().toLowerCase();
  return (m = reHex.exec(format)) ? (l = m[1].length, m = parseInt(m[1], 16), l === 6 ? rgbn(m) : l === 3 ? new Rgb(m >> 8 & 15 | m >> 4 & 240, m >> 4 & 15 | m & 240, (m & 15) << 4 | m & 15, 1) : l === 8 ? rgba(m >> 24 & 255, m >> 16 & 255, m >> 8 & 255, (m & 255) / 255) : l === 4 ? rgba(m >> 12 & 15 | m >> 8 & 240, m >> 8 & 15 | m >> 4 & 240, m >> 4 & 15 | m & 240, ((m & 15) << 4 | m & 15) / 255) : null) : (m = reRgbInteger.exec(format)) ? new Rgb(m[1], m[2], m[3], 1) : (m = reRgbPercent.exec(format)) ? new Rgb(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, 1) : (m = reRgbaInteger.exec(format)) ? rgba(m[1], m[2], m[3], m[4]) : (m = reRgbaPercent.exec(format)) ? rgba(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, m[4]) : (m = reHslPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, 1) : (m = reHslaPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, m[4]) : named.hasOwnProperty(format) ? rgbn(named[format]) : format === "transparent" ? new Rgb(NaN, NaN, NaN, 0) : null;
}
function rgbn(n) {
  return new Rgb(n >> 16 & 255, n >> 8 & 255, n & 255, 1);
}
function rgba(r, g, b, a) {
  if (a <= 0) r = g = b = NaN;
  return new Rgb(r, g, b, a);
}
function rgbConvert(o) {
  if (!(o instanceof Color)) o = color(o);
  if (!o) return new Rgb();
  o = o.rgb();
  return new Rgb(o.r, o.g, o.b, o.opacity);
}
function rgb(r, g, b, opacity) {
  return arguments.length === 1 ? rgbConvert(r) : new Rgb(r, g, b, opacity == null ? 1 : opacity);
}
function Rgb(r, g, b, opacity) {
  this.r = +r;
  this.g = +g;
  this.b = +b;
  this.opacity = +opacity;
}
define_default(Rgb, rgb, extend(Color, {
  brighter(k) {
    k = k == null ? brighter : Math.pow(brighter, k);
    return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
  },
  darker(k) {
    k = k == null ? darker : Math.pow(darker, k);
    return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
  },
  rgb() {
    return this;
  },
  clamp() {
    return new Rgb(clampi(this.r), clampi(this.g), clampi(this.b), clampa(this.opacity));
  },
  displayable() {
    return -0.5 <= this.r && this.r < 255.5 && (-0.5 <= this.g && this.g < 255.5) && (-0.5 <= this.b && this.b < 255.5) && (0 <= this.opacity && this.opacity <= 1);
  },
  hex: rgb_formatHex,
  // Deprecated! Use color.formatHex.
  formatHex: rgb_formatHex,
  formatHex8: rgb_formatHex8,
  formatRgb: rgb_formatRgb,
  toString: rgb_formatRgb
}));
function rgb_formatHex() {
  return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}`;
}
function rgb_formatHex8() {
  return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}${hex((isNaN(this.opacity) ? 1 : this.opacity) * 255)}`;
}
function rgb_formatRgb() {
  const a = clampa(this.opacity);
  return `${a === 1 ? "rgb(" : "rgba("}${clampi(this.r)}, ${clampi(this.g)}, ${clampi(this.b)}${a === 1 ? ")" : `, ${a})`}`;
}
function clampa(opacity) {
  return isNaN(opacity) ? 1 : Math.max(0, Math.min(1, opacity));
}
function clampi(value) {
  return Math.max(0, Math.min(255, Math.round(value) || 0));
}
function hex(value) {
  value = clampi(value);
  return (value < 16 ? "0" : "") + value.toString(16);
}
function hsla(h, s, l, a) {
  if (a <= 0) h = s = l = NaN;
  else if (l <= 0 || l >= 1) h = s = NaN;
  else if (s <= 0) h = NaN;
  return new Hsl(h, s, l, a);
}
function hslConvert(o) {
  if (o instanceof Hsl) return new Hsl(o.h, o.s, o.l, o.opacity);
  if (!(o instanceof Color)) o = color(o);
  if (!o) return new Hsl();
  if (o instanceof Hsl) return o;
  o = o.rgb();
  var r = o.r / 255, g = o.g / 255, b = o.b / 255, min = Math.min(r, g, b), max = Math.max(r, g, b), h = NaN, s = max - min, l = (max + min) / 2;
  if (s) {
    if (r === max) h = (g - b) / s + (g < b) * 6;
    else if (g === max) h = (b - r) / s + 2;
    else h = (r - g) / s + 4;
    s /= l < 0.5 ? max + min : 2 - max - min;
    h *= 60;
  } else {
    s = l > 0 && l < 1 ? 0 : h;
  }
  return new Hsl(h, s, l, o.opacity);
}
function hsl(h, s, l, opacity) {
  return arguments.length === 1 ? hslConvert(h) : new Hsl(h, s, l, opacity == null ? 1 : opacity);
}
function Hsl(h, s, l, opacity) {
  this.h = +h;
  this.s = +s;
  this.l = +l;
  this.opacity = +opacity;
}
define_default(Hsl, hsl, extend(Color, {
  brighter(k) {
    k = k == null ? brighter : Math.pow(brighter, k);
    return new Hsl(this.h, this.s, this.l * k, this.opacity);
  },
  darker(k) {
    k = k == null ? darker : Math.pow(darker, k);
    return new Hsl(this.h, this.s, this.l * k, this.opacity);
  },
  rgb() {
    var h = this.h % 360 + (this.h < 0) * 360, s = isNaN(h) || isNaN(this.s) ? 0 : this.s, l = this.l, m2 = l + (l < 0.5 ? l : 1 - l) * s, m1 = 2 * l - m2;
    return new Rgb(
      hsl2rgb(h >= 240 ? h - 240 : h + 120, m1, m2),
      hsl2rgb(h, m1, m2),
      hsl2rgb(h < 120 ? h + 240 : h - 120, m1, m2),
      this.opacity
    );
  },
  clamp() {
    return new Hsl(clamph(this.h), clampt(this.s), clampt(this.l), clampa(this.opacity));
  },
  displayable() {
    return (0 <= this.s && this.s <= 1 || isNaN(this.s)) && (0 <= this.l && this.l <= 1) && (0 <= this.opacity && this.opacity <= 1);
  },
  formatHsl() {
    const a = clampa(this.opacity);
    return `${a === 1 ? "hsl(" : "hsla("}${clamph(this.h)}, ${clampt(this.s) * 100}%, ${clampt(this.l) * 100}%${a === 1 ? ")" : `, ${a})`}`;
  }
}));
function clamph(value) {
  value = (value || 0) % 360;
  return value < 0 ? value + 360 : value;
}
function clampt(value) {
  return Math.max(0, Math.min(1, value || 0));
}
function hsl2rgb(h, m1, m2) {
  return (h < 60 ? m1 + (m2 - m1) * h / 60 : h < 180 ? m2 : h < 240 ? m1 + (m2 - m1) * (240 - h) / 60 : m1) * 255;
}

// node_modules/d3-color/src/math.js
var radians = Math.PI / 180;
var degrees = 180 / Math.PI;

// node_modules/d3-color/src/lab.js
var K = 18;
var Xn = 0.96422;
var Yn = 1;
var Zn = 0.82521;
var t0 = 4 / 29;
var t1 = 6 / 29;
var t2 = 3 * t1 * t1;
var t3 = t1 * t1 * t1;
function labConvert(o) {
  if (o instanceof Lab) return new Lab(o.l, o.a, o.b, o.opacity);
  if (o instanceof Hcl) return hcl2lab(o);
  if (!(o instanceof Rgb)) o = rgbConvert(o);
  var r = rgb2lrgb(o.r), g = rgb2lrgb(o.g), b = rgb2lrgb(o.b), y = xyz2lab((0.2225045 * r + 0.7168786 * g + 0.0606169 * b) / Yn), x, z;
  if (r === g && g === b) x = z = y;
  else {
    x = xyz2lab((0.4360747 * r + 0.3850649 * g + 0.1430804 * b) / Xn);
    z = xyz2lab((0.0139322 * r + 0.0971045 * g + 0.7141733 * b) / Zn);
  }
  return new Lab(116 * y - 16, 500 * (x - y), 200 * (y - z), o.opacity);
}
function lab(l, a, b, opacity) {
  return arguments.length === 1 ? labConvert(l) : new Lab(l, a, b, opacity == null ? 1 : opacity);
}
function Lab(l, a, b, opacity) {
  this.l = +l;
  this.a = +a;
  this.b = +b;
  this.opacity = +opacity;
}
define_default(Lab, lab, extend(Color, {
  brighter(k) {
    return new Lab(this.l + K * (k == null ? 1 : k), this.a, this.b, this.opacity);
  },
  darker(k) {
    return new Lab(this.l - K * (k == null ? 1 : k), this.a, this.b, this.opacity);
  },
  rgb() {
    var y = (this.l + 16) / 116, x = isNaN(this.a) ? y : y + this.a / 500, z = isNaN(this.b) ? y : y - this.b / 200;
    x = Xn * lab2xyz(x);
    y = Yn * lab2xyz(y);
    z = Zn * lab2xyz(z);
    return new Rgb(
      lrgb2rgb(3.1338561 * x - 1.6168667 * y - 0.4906146 * z),
      lrgb2rgb(-0.9787684 * x + 1.9161415 * y + 0.033454 * z),
      lrgb2rgb(0.0719453 * x - 0.2289914 * y + 1.4052427 * z),
      this.opacity
    );
  }
}));
function xyz2lab(t) {
  return t > t3 ? Math.pow(t, 1 / 3) : t / t2 + t0;
}
function lab2xyz(t) {
  return t > t1 ? t * t * t : t2 * (t - t0);
}
function lrgb2rgb(x) {
  return 255 * (x <= 31308e-7 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
}
function rgb2lrgb(x) {
  return (x /= 255) <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
function hclConvert(o) {
  if (o instanceof Hcl) return new Hcl(o.h, o.c, o.l, o.opacity);
  if (!(o instanceof Lab)) o = labConvert(o);
  if (o.a === 0 && o.b === 0) return new Hcl(NaN, 0 < o.l && o.l < 100 ? 0 : NaN, o.l, o.opacity);
  var h = Math.atan2(o.b, o.a) * degrees;
  return new Hcl(h < 0 ? h + 360 : h, Math.sqrt(o.a * o.a + o.b * o.b), o.l, o.opacity);
}
function hcl(h, c, l, opacity) {
  return arguments.length === 1 ? hclConvert(h) : new Hcl(h, c, l, opacity == null ? 1 : opacity);
}
function Hcl(h, c, l, opacity) {
  this.h = +h;
  this.c = +c;
  this.l = +l;
  this.opacity = +opacity;
}
function hcl2lab(o) {
  if (isNaN(o.h)) return new Lab(o.l, 0, 0, o.opacity);
  var h = o.h * radians;
  return new Lab(o.l, Math.cos(h) * o.c, Math.sin(h) * o.c, o.opacity);
}
define_default(Hcl, hcl, extend(Color, {
  brighter(k) {
    return new Hcl(this.h, this.c, this.l + K * (k == null ? 1 : k), this.opacity);
  },
  darker(k) {
    return new Hcl(this.h, this.c, this.l - K * (k == null ? 1 : k), this.opacity);
  },
  rgb() {
    return hcl2lab(this).rgb();
  }
}));

// node_modules/d3-color/src/cubehelix.js
var A = -0.14861;
var B = 1.78277;
var C = -0.29227;
var D = -0.90649;
var E = 1.97294;
var ED = E * D;
var EB = E * B;
var BC_DA = B * C - D * A;
function cubehelixConvert(o) {
  if (o instanceof Cubehelix) return new Cubehelix(o.h, o.s, o.l, o.opacity);
  if (!(o instanceof Rgb)) o = rgbConvert(o);
  var r = o.r / 255, g = o.g / 255, b = o.b / 255, l = (BC_DA * b + ED * r - EB * g) / (BC_DA + ED - EB), bl = b - l, k = (E * (g - l) - C * bl) / D, s = Math.sqrt(k * k + bl * bl) / (E * l * (1 - l)), h = s ? Math.atan2(k, bl) * degrees - 120 : NaN;
  return new Cubehelix(h < 0 ? h + 360 : h, s, l, o.opacity);
}
function cubehelix(h, s, l, opacity) {
  return arguments.length === 1 ? cubehelixConvert(h) : new Cubehelix(h, s, l, opacity == null ? 1 : opacity);
}
function Cubehelix(h, s, l, opacity) {
  this.h = +h;
  this.s = +s;
  this.l = +l;
  this.opacity = +opacity;
}
define_default(Cubehelix, cubehelix, extend(Color, {
  brighter(k) {
    k = k == null ? brighter : Math.pow(brighter, k);
    return new Cubehelix(this.h, this.s, this.l * k, this.opacity);
  },
  darker(k) {
    k = k == null ? darker : Math.pow(darker, k);
    return new Cubehelix(this.h, this.s, this.l * k, this.opacity);
  },
  rgb() {
    var h = isNaN(this.h) ? 0 : (this.h + 120) * radians, l = +this.l, a = isNaN(this.s) ? 0 : this.s * l * (1 - l), cosh2 = Math.cos(h), sinh2 = Math.sin(h);
    return new Rgb(
      255 * (l + a * (A * cosh2 + B * sinh2)),
      255 * (l + a * (C * cosh2 + D * sinh2)),
      255 * (l + a * (E * cosh2)),
      this.opacity
    );
  }
}));

// node_modules/d3-interpolate/src/basis.js
function basis(t12, v0, v1, v2, v3) {
  var t22 = t12 * t12, t32 = t22 * t12;
  return ((1 - 3 * t12 + 3 * t22 - t32) * v0 + (4 - 6 * t22 + 3 * t32) * v1 + (1 + 3 * t12 + 3 * t22 - 3 * t32) * v2 + t32 * v3) / 6;
}
function basis_default(values) {
  var n = values.length - 1;
  return function(t) {
    var i = t <= 0 ? t = 0 : t >= 1 ? (t = 1, n - 1) : Math.floor(t * n), v1 = values[i], v2 = values[i + 1], v0 = i > 0 ? values[i - 1] : 2 * v1 - v2, v3 = i < n - 1 ? values[i + 2] : 2 * v2 - v1;
    return basis((t - i / n) * n, v0, v1, v2, v3);
  };
}

// node_modules/d3-interpolate/src/basisClosed.js
function basisClosed_default(values) {
  var n = values.length;
  return function(t) {
    var i = Math.floor(((t %= 1) < 0 ? ++t : t) * n), v0 = values[(i + n - 1) % n], v1 = values[i % n], v2 = values[(i + 1) % n], v3 = values[(i + 2) % n];
    return basis((t - i / n) * n, v0, v1, v2, v3);
  };
}

// node_modules/d3-interpolate/src/constant.js
var constant_default3 = (x) => () => x;

// node_modules/d3-interpolate/src/color.js
function linear(a, d) {
  return function(t) {
    return a + t * d;
  };
}
function exponential(a, b, y) {
  return a = Math.pow(a, y), b = Math.pow(b, y) - a, y = 1 / y, function(t) {
    return Math.pow(a + t * b, y);
  };
}
function hue(a, b) {
  var d = b - a;
  return d ? linear(a, d > 180 || d < -180 ? d - 360 * Math.round(d / 360) : d) : constant_default3(isNaN(a) ? b : a);
}
function gamma(y) {
  return (y = +y) === 1 ? nogamma : function(a, b) {
    return b - a ? exponential(a, b, y) : constant_default3(isNaN(a) ? b : a);
  };
}
function nogamma(a, b) {
  var d = b - a;
  return d ? linear(a, d) : constant_default3(isNaN(a) ? b : a);
}

// node_modules/d3-interpolate/src/rgb.js
var rgb_default = (function rgbGamma(y) {
  var color2 = gamma(y);
  function rgb2(start2, end) {
    var r = color2((start2 = rgb(start2)).r, (end = rgb(end)).r), g = color2(start2.g, end.g), b = color2(start2.b, end.b), opacity = nogamma(start2.opacity, end.opacity);
    return function(t) {
      start2.r = r(t);
      start2.g = g(t);
      start2.b = b(t);
      start2.opacity = opacity(t);
      return start2 + "";
    };
  }
  rgb2.gamma = rgbGamma;
  return rgb2;
})(1);
function rgbSpline(spline) {
  return function(colors) {
    var n = colors.length, r = new Array(n), g = new Array(n), b = new Array(n), i, color2;
    for (i = 0; i < n; ++i) {
      color2 = rgb(colors[i]);
      r[i] = color2.r || 0;
      g[i] = color2.g || 0;
      b[i] = color2.b || 0;
    }
    r = spline(r);
    g = spline(g);
    b = spline(b);
    color2.opacity = 1;
    return function(t) {
      color2.r = r(t);
      color2.g = g(t);
      color2.b = b(t);
      return color2 + "";
    };
  };
}
var rgbBasis = rgbSpline(basis_default);
var rgbBasisClosed = rgbSpline(basisClosed_default);

// node_modules/d3-interpolate/src/number.js
function number_default(a, b) {
  return a = +a, b = +b, function(t) {
    return a * (1 - t) + b * t;
  };
}

// node_modules/d3-interpolate/src/string.js
var reA = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g;
var reB = new RegExp(reA.source, "g");
function zero(b) {
  return function() {
    return b;
  };
}
function one(b) {
  return function(t) {
    return b(t) + "";
  };
}
function string_default(a, b) {
  var bi = reA.lastIndex = reB.lastIndex = 0, am, bm, bs, i = -1, s = [], q = [];
  a = a + "", b = b + "";
  while ((am = reA.exec(a)) && (bm = reB.exec(b))) {
    if ((bs = bm.index) > bi) {
      bs = b.slice(bi, bs);
      if (s[i]) s[i] += bs;
      else s[++i] = bs;
    }
    if ((am = am[0]) === (bm = bm[0])) {
      if (s[i]) s[i] += bm;
      else s[++i] = bm;
    } else {
      s[++i] = null;
      q.push({ i, x: number_default(am, bm) });
    }
    bi = reB.lastIndex;
  }
  if (bi < b.length) {
    bs = b.slice(bi);
    if (s[i]) s[i] += bs;
    else s[++i] = bs;
  }
  return s.length < 2 ? q[0] ? one(q[0].x) : zero(b) : (b = q.length, function(t) {
    for (var i2 = 0, o; i2 < b; ++i2) s[(o = q[i2]).i] = o.x(t);
    return s.join("");
  });
}

// node_modules/d3-interpolate/src/transform/decompose.js
var degrees2 = 180 / Math.PI;
var identity = {
  translateX: 0,
  translateY: 0,
  rotate: 0,
  skewX: 0,
  scaleX: 1,
  scaleY: 1
};
function decompose_default(a, b, c, d, e, f) {
  var scaleX, scaleY, skewX;
  if (scaleX = Math.sqrt(a * a + b * b)) a /= scaleX, b /= scaleX;
  if (skewX = a * c + b * d) c -= a * skewX, d -= b * skewX;
  if (scaleY = Math.sqrt(c * c + d * d)) c /= scaleY, d /= scaleY, skewX /= scaleY;
  if (a * d < b * c) a = -a, b = -b, skewX = -skewX, scaleX = -scaleX;
  return {
    translateX: e,
    translateY: f,
    rotate: Math.atan2(b, a) * degrees2,
    skewX: Math.atan(skewX) * degrees2,
    scaleX,
    scaleY
  };
}

// node_modules/d3-interpolate/src/transform/parse.js
var svgNode;
function parseCss(value) {
  const m = new (typeof DOMMatrix === "function" ? DOMMatrix : WebKitCSSMatrix)(value + "");
  return m.isIdentity ? identity : decompose_default(m.a, m.b, m.c, m.d, m.e, m.f);
}
function parseSvg(value) {
  if (value == null) return identity;
  if (!svgNode) svgNode = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svgNode.setAttribute("transform", value);
  if (!(value = svgNode.transform.baseVal.consolidate())) return identity;
  value = value.matrix;
  return decompose_default(value.a, value.b, value.c, value.d, value.e, value.f);
}

// node_modules/d3-interpolate/src/transform/index.js
function interpolateTransform(parse, pxComma, pxParen, degParen) {
  function pop(s) {
    return s.length ? s.pop() + " " : "";
  }
  function translate(xa, ya, xb, yb, s, q) {
    if (xa !== xb || ya !== yb) {
      var i = s.push("translate(", null, pxComma, null, pxParen);
      q.push({ i: i - 4, x: number_default(xa, xb) }, { i: i - 2, x: number_default(ya, yb) });
    } else if (xb || yb) {
      s.push("translate(" + xb + pxComma + yb + pxParen);
    }
  }
  function rotate(a, b, s, q) {
    if (a !== b) {
      if (a - b > 180) b += 360;
      else if (b - a > 180) a += 360;
      q.push({ i: s.push(pop(s) + "rotate(", null, degParen) - 2, x: number_default(a, b) });
    } else if (b) {
      s.push(pop(s) + "rotate(" + b + degParen);
    }
  }
  function skewX(a, b, s, q) {
    if (a !== b) {
      q.push({ i: s.push(pop(s) + "skewX(", null, degParen) - 2, x: number_default(a, b) });
    } else if (b) {
      s.push(pop(s) + "skewX(" + b + degParen);
    }
  }
  function scale(xa, ya, xb, yb, s, q) {
    if (xa !== xb || ya !== yb) {
      var i = s.push(pop(s) + "scale(", null, ",", null, ")");
      q.push({ i: i - 4, x: number_default(xa, xb) }, { i: i - 2, x: number_default(ya, yb) });
    } else if (xb !== 1 || yb !== 1) {
      s.push(pop(s) + "scale(" + xb + "," + yb + ")");
    }
  }
  return function(a, b) {
    var s = [], q = [];
    a = parse(a), b = parse(b);
    translate(a.translateX, a.translateY, b.translateX, b.translateY, s, q);
    rotate(a.rotate, b.rotate, s, q);
    skewX(a.skewX, b.skewX, s, q);
    scale(a.scaleX, a.scaleY, b.scaleX, b.scaleY, s, q);
    a = b = null;
    return function(t) {
      var i = -1, n = q.length, o;
      while (++i < n) s[(o = q[i]).i] = o.x(t);
      return s.join("");
    };
  };
}
var interpolateTransformCss = interpolateTransform(parseCss, "px, ", "px)", "deg)");
var interpolateTransformSvg = interpolateTransform(parseSvg, ", ", ")", ")");

// node_modules/d3-interpolate/src/zoom.js
var epsilon2 = 1e-12;
function cosh(x) {
  return ((x = Math.exp(x)) + 1 / x) / 2;
}
function sinh(x) {
  return ((x = Math.exp(x)) - 1 / x) / 2;
}
function tanh(x) {
  return ((x = Math.exp(2 * x)) - 1) / (x + 1);
}
var zoom_default = (function zoomRho(rho, rho2, rho4) {
  function zoom(p0, p1) {
    var ux0 = p0[0], uy0 = p0[1], w0 = p0[2], ux1 = p1[0], uy1 = p1[1], w1 = p1[2], dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy, i, S;
    if (d2 < epsilon2) {
      S = Math.log(w1 / w0) / rho;
      i = function(t) {
        return [
          ux0 + t * dx,
          uy0 + t * dy,
          w0 * Math.exp(rho * t * S)
        ];
      };
    } else {
      var d1 = Math.sqrt(d2), b02 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1), b12 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1), r0 = Math.log(Math.sqrt(b02 * b02 + 1) - b02), r1 = Math.log(Math.sqrt(b12 * b12 + 1) - b12);
      S = (r1 - r0) / rho;
      i = function(t) {
        var s = t * S, coshr0 = cosh(r0), u = w0 / (rho2 * d1) * (coshr0 * tanh(rho * s + r0) - sinh(r0));
        return [
          ux0 + u * dx,
          uy0 + u * dy,
          w0 * coshr0 / cosh(rho * s + r0)
        ];
      };
    }
    i.duration = S * 1e3 * rho / Math.SQRT2;
    return i;
  }
  zoom.rho = function(_) {
    var _1 = Math.max(1e-3, +_), _2 = _1 * _1, _4 = _2 * _2;
    return zoomRho(_1, _2, _4);
  };
  return zoom;
})(Math.SQRT2, 2, 4);

// node_modules/d3-interpolate/src/hsl.js
function hsl2(hue2) {
  return function(start2, end) {
    var h = hue2((start2 = hsl(start2)).h, (end = hsl(end)).h), s = nogamma(start2.s, end.s), l = nogamma(start2.l, end.l), opacity = nogamma(start2.opacity, end.opacity);
    return function(t) {
      start2.h = h(t);
      start2.s = s(t);
      start2.l = l(t);
      start2.opacity = opacity(t);
      return start2 + "";
    };
  };
}
var hsl_default = hsl2(hue);
var hslLong = hsl2(nogamma);

// node_modules/d3-interpolate/src/hcl.js
function hcl2(hue2) {
  return function(start2, end) {
    var h = hue2((start2 = hcl(start2)).h, (end = hcl(end)).h), c = nogamma(start2.c, end.c), l = nogamma(start2.l, end.l), opacity = nogamma(start2.opacity, end.opacity);
    return function(t) {
      start2.h = h(t);
      start2.c = c(t);
      start2.l = l(t);
      start2.opacity = opacity(t);
      return start2 + "";
    };
  };
}
var hcl_default = hcl2(hue);
var hclLong = hcl2(nogamma);

// node_modules/d3-interpolate/src/cubehelix.js
function cubehelix2(hue2) {
  return (function cubehelixGamma(y) {
    y = +y;
    function cubehelix3(start2, end) {
      var h = hue2((start2 = cubehelix(start2)).h, (end = cubehelix(end)).h), s = nogamma(start2.s, end.s), l = nogamma(start2.l, end.l), opacity = nogamma(start2.opacity, end.opacity);
      return function(t) {
        start2.h = h(t);
        start2.s = s(t);
        start2.l = l(Math.pow(t, y));
        start2.opacity = opacity(t);
        return start2 + "";
      };
    }
    cubehelix3.gamma = cubehelixGamma;
    return cubehelix3;
  })(1);
}
var cubehelix_default = cubehelix2(hue);
var cubehelixLong = cubehelix2(nogamma);

// node_modules/d3-timer/src/timer.js
var frame = 0;
var timeout = 0;
var interval = 0;
var pokeDelay = 1e3;
var taskHead;
var taskTail;
var clockLast = 0;
var clockNow = 0;
var clockSkew = 0;
var clock = typeof performance === "object" && performance.now ? performance : Date;
var setFrame = typeof window === "object" && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(f) {
  setTimeout(f, 17);
};
function now() {
  return clockNow || (setFrame(clearNow), clockNow = clock.now() + clockSkew);
}
function clearNow() {
  clockNow = 0;
}
function Timer() {
  this._call = this._time = this._next = null;
}
Timer.prototype = timer.prototype = {
  constructor: Timer,
  restart: function(callback, delay, time) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    time = (time == null ? now() : +time) + (delay == null ? 0 : +delay);
    if (!this._next && taskTail !== this) {
      if (taskTail) taskTail._next = this;
      else taskHead = this;
      taskTail = this;
    }
    this._call = callback;
    this._time = time;
    sleep();
  },
  stop: function() {
    if (this._call) {
      this._call = null;
      this._time = Infinity;
      sleep();
    }
  }
};
function timer(callback, delay, time) {
  var t = new Timer();
  t.restart(callback, delay, time);
  return t;
}
function timerFlush() {
  now();
  ++frame;
  var t = taskHead, e;
  while (t) {
    if ((e = clockNow - t._time) >= 0) t._call.call(void 0, e);
    t = t._next;
  }
  --frame;
}
function wake() {
  clockNow = (clockLast = clock.now()) + clockSkew;
  frame = timeout = 0;
  try {
    timerFlush();
  } finally {
    frame = 0;
    nap();
    clockNow = 0;
  }
}
function poke() {
  var now2 = clock.now(), delay = now2 - clockLast;
  if (delay > pokeDelay) clockSkew -= delay, clockLast = now2;
}
function nap() {
  var t02, t12 = taskHead, t22, time = Infinity;
  while (t12) {
    if (t12._call) {
      if (time > t12._time) time = t12._time;
      t02 = t12, t12 = t12._next;
    } else {
      t22 = t12._next, t12._next = null;
      t12 = t02 ? t02._next = t22 : taskHead = t22;
    }
  }
  taskTail = t02;
  sleep(time);
}
function sleep(time) {
  if (frame) return;
  if (timeout) timeout = clearTimeout(timeout);
  var delay = time - clockNow;
  if (delay > 24) {
    if (time < Infinity) timeout = setTimeout(wake, time - clock.now() - clockSkew);
    if (interval) interval = clearInterval(interval);
  } else {
    if (!interval) clockLast = clock.now(), interval = setInterval(poke, pokeDelay);
    frame = 1, setFrame(wake);
  }
}

// node_modules/d3-timer/src/timeout.js
function timeout_default(callback, delay, time) {
  var t = new Timer();
  delay = delay == null ? 0 : +delay;
  t.restart((elapsed) => {
    t.stop();
    callback(elapsed + delay);
  }, delay, time);
  return t;
}

// node_modules/d3-transition/src/transition/schedule.js
var emptyOn = dispatch_default2("start", "end", "cancel", "interrupt");
var emptyTween = [];
var CREATED = 0;
var SCHEDULED = 1;
var STARTING = 2;
var STARTED = 3;
var RUNNING = 4;
var ENDING = 5;
var ENDED = 6;
function schedule_default(node, name, id3, index, group, timing) {
  var schedules = node.__transition;
  if (!schedules) node.__transition = {};
  else if (id3 in schedules) return;
  create(node, id3, {
    name,
    index,
    // For context during callback.
    group,
    // For context during callback.
    on: emptyOn,
    tween: emptyTween,
    time: timing.time,
    delay: timing.delay,
    duration: timing.duration,
    ease: timing.ease,
    timer: null,
    state: CREATED
  });
}
function init(node, id3) {
  var schedule = get2(node, id3);
  if (schedule.state > CREATED) throw new Error("too late; already scheduled");
  return schedule;
}
function set2(node, id3) {
  var schedule = get2(node, id3);
  if (schedule.state > STARTED) throw new Error("too late; already running");
  return schedule;
}
function get2(node, id3) {
  var schedule = node.__transition;
  if (!schedule || !(schedule = schedule[id3])) throw new Error("transition not found");
  return schedule;
}
function create(node, id3, self) {
  var schedules = node.__transition, tween;
  schedules[id3] = self;
  self.timer = timer(schedule, 0, self.time);
  function schedule(elapsed) {
    self.state = SCHEDULED;
    self.timer.restart(start2, self.delay, self.time);
    if (self.delay <= elapsed) start2(elapsed - self.delay);
  }
  function start2(elapsed) {
    var i, j, n, o;
    if (self.state !== SCHEDULED) return stop();
    for (i in schedules) {
      o = schedules[i];
      if (o.name !== self.name) continue;
      if (o.state === STARTED) return timeout_default(start2);
      if (o.state === RUNNING) {
        o.state = ENDED;
        o.timer.stop();
        o.on.call("interrupt", node, node.__data__, o.index, o.group);
        delete schedules[i];
      } else if (+i < id3) {
        o.state = ENDED;
        o.timer.stop();
        o.on.call("cancel", node, node.__data__, o.index, o.group);
        delete schedules[i];
      }
    }
    timeout_default(function() {
      if (self.state === STARTED) {
        self.state = RUNNING;
        self.timer.restart(tick, self.delay, self.time);
        tick(elapsed);
      }
    });
    self.state = STARTING;
    self.on.call("start", node, node.__data__, self.index, self.group);
    if (self.state !== STARTING) return;
    self.state = STARTED;
    tween = new Array(n = self.tween.length);
    for (i = 0, j = -1; i < n; ++i) {
      if (o = self.tween[i].value.call(node, node.__data__, self.index, self.group)) {
        tween[++j] = o;
      }
    }
    tween.length = j + 1;
  }
  function tick(elapsed) {
    var t = elapsed < self.duration ? self.ease.call(null, elapsed / self.duration) : (self.timer.restart(stop), self.state = ENDING, 1), i = -1, n = tween.length;
    while (++i < n) {
      tween[i].call(node, t);
    }
    if (self.state === ENDING) {
      self.on.call("end", node, node.__data__, self.index, self.group);
      stop();
    }
  }
  function stop() {
    self.state = ENDED;
    self.timer.stop();
    delete schedules[id3];
    for (var i in schedules) return;
    delete node.__transition;
  }
}

// node_modules/d3-transition/src/interrupt.js
function interrupt_default(node, name) {
  var schedules = node.__transition, schedule, active, empty2 = true, i;
  if (!schedules) return;
  name = name == null ? null : name + "";
  for (i in schedules) {
    if ((schedule = schedules[i]).name !== name) {
      empty2 = false;
      continue;
    }
    active = schedule.state > STARTING && schedule.state < ENDING;
    schedule.state = ENDED;
    schedule.timer.stop();
    schedule.on.call(active ? "interrupt" : "cancel", node, node.__data__, schedule.index, schedule.group);
    delete schedules[i];
  }
  if (empty2) delete node.__transition;
}

// node_modules/d3-transition/src/selection/interrupt.js
function interrupt_default2(name) {
  return this.each(function() {
    interrupt_default(this, name);
  });
}

// node_modules/d3-transition/src/transition/tween.js
function tweenRemove(id3, name) {
  var tween0, tween1;
  return function() {
    var schedule = set2(this, id3), tween = schedule.tween;
    if (tween !== tween0) {
      tween1 = tween0 = tween;
      for (var i = 0, n = tween1.length; i < n; ++i) {
        if (tween1[i].name === name) {
          tween1 = tween1.slice();
          tween1.splice(i, 1);
          break;
        }
      }
    }
    schedule.tween = tween1;
  };
}
function tweenFunction(id3, name, value) {
  var tween0, tween1;
  if (typeof value !== "function") throw new Error();
  return function() {
    var schedule = set2(this, id3), tween = schedule.tween;
    if (tween !== tween0) {
      tween1 = (tween0 = tween).slice();
      for (var t = { name, value }, i = 0, n = tween1.length; i < n; ++i) {
        if (tween1[i].name === name) {
          tween1[i] = t;
          break;
        }
      }
      if (i === n) tween1.push(t);
    }
    schedule.tween = tween1;
  };
}
function tween_default(name, value) {
  var id3 = this._id;
  name += "";
  if (arguments.length < 2) {
    var tween = get2(this.node(), id3).tween;
    for (var i = 0, n = tween.length, t; i < n; ++i) {
      if ((t = tween[i]).name === name) {
        return t.value;
      }
    }
    return null;
  }
  return this.each((value == null ? tweenRemove : tweenFunction)(id3, name, value));
}
function tweenValue(transition2, name, value) {
  var id3 = transition2._id;
  transition2.each(function() {
    var schedule = set2(this, id3);
    (schedule.value || (schedule.value = {}))[name] = value.apply(this, arguments);
  });
  return function(node) {
    return get2(node, id3).value[name];
  };
}

// node_modules/d3-transition/src/transition/interpolate.js
function interpolate_default(a, b) {
  var c;
  return (typeof b === "number" ? number_default : b instanceof color ? rgb_default : (c = color(b)) ? (b = c, rgb_default) : string_default)(a, b);
}

// node_modules/d3-transition/src/transition/attr.js
function attrRemove2(name) {
  return function() {
    this.removeAttribute(name);
  };
}
function attrRemoveNS2(fullname) {
  return function() {
    this.removeAttributeNS(fullname.space, fullname.local);
  };
}
function attrConstant2(name, interpolate, value1) {
  var string00, string1 = value1 + "", interpolate0;
  return function() {
    var string0 = this.getAttribute(name);
    return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate(string00 = string0, value1);
  };
}
function attrConstantNS2(fullname, interpolate, value1) {
  var string00, string1 = value1 + "", interpolate0;
  return function() {
    var string0 = this.getAttributeNS(fullname.space, fullname.local);
    return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate(string00 = string0, value1);
  };
}
function attrFunction2(name, interpolate, value) {
  var string00, string10, interpolate0;
  return function() {
    var string0, value1 = value(this), string1;
    if (value1 == null) return void this.removeAttribute(name);
    string0 = this.getAttribute(name);
    string1 = value1 + "";
    return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate(string00 = string0, value1));
  };
}
function attrFunctionNS2(fullname, interpolate, value) {
  var string00, string10, interpolate0;
  return function() {
    var string0, value1 = value(this), string1;
    if (value1 == null) return void this.removeAttributeNS(fullname.space, fullname.local);
    string0 = this.getAttributeNS(fullname.space, fullname.local);
    string1 = value1 + "";
    return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate(string00 = string0, value1));
  };
}
function attr_default2(name, value) {
  var fullname = namespace_default(name), i = fullname === "transform" ? interpolateTransformSvg : interpolate_default;
  return this.attrTween(name, typeof value === "function" ? (fullname.local ? attrFunctionNS2 : attrFunction2)(fullname, i, tweenValue(this, "attr." + name, value)) : value == null ? (fullname.local ? attrRemoveNS2 : attrRemove2)(fullname) : (fullname.local ? attrConstantNS2 : attrConstant2)(fullname, i, value));
}

// node_modules/d3-transition/src/transition/attrTween.js
function attrInterpolate(name, i) {
  return function(t) {
    this.setAttribute(name, i.call(this, t));
  };
}
function attrInterpolateNS(fullname, i) {
  return function(t) {
    this.setAttributeNS(fullname.space, fullname.local, i.call(this, t));
  };
}
function attrTweenNS(fullname, value) {
  var t02, i0;
  function tween() {
    var i = value.apply(this, arguments);
    if (i !== i0) t02 = (i0 = i) && attrInterpolateNS(fullname, i);
    return t02;
  }
  tween._value = value;
  return tween;
}
function attrTween(name, value) {
  var t02, i0;
  function tween() {
    var i = value.apply(this, arguments);
    if (i !== i0) t02 = (i0 = i) && attrInterpolate(name, i);
    return t02;
  }
  tween._value = value;
  return tween;
}
function attrTween_default(name, value) {
  var key = "attr." + name;
  if (arguments.length < 2) return (key = this.tween(key)) && key._value;
  if (value == null) return this.tween(key, null);
  if (typeof value !== "function") throw new Error();
  var fullname = namespace_default(name);
  return this.tween(key, (fullname.local ? attrTweenNS : attrTween)(fullname, value));
}

// node_modules/d3-transition/src/transition/delay.js
function delayFunction(id3, value) {
  return function() {
    init(this, id3).delay = +value.apply(this, arguments);
  };
}
function delayConstant(id3, value) {
  return value = +value, function() {
    init(this, id3).delay = value;
  };
}
function delay_default(value) {
  var id3 = this._id;
  return arguments.length ? this.each((typeof value === "function" ? delayFunction : delayConstant)(id3, value)) : get2(this.node(), id3).delay;
}

// node_modules/d3-transition/src/transition/duration.js
function durationFunction(id3, value) {
  return function() {
    set2(this, id3).duration = +value.apply(this, arguments);
  };
}
function durationConstant(id3, value) {
  return value = +value, function() {
    set2(this, id3).duration = value;
  };
}
function duration_default(value) {
  var id3 = this._id;
  return arguments.length ? this.each((typeof value === "function" ? durationFunction : durationConstant)(id3, value)) : get2(this.node(), id3).duration;
}

// node_modules/d3-transition/src/transition/ease.js
function easeConstant(id3, value) {
  if (typeof value !== "function") throw new Error();
  return function() {
    set2(this, id3).ease = value;
  };
}
function ease_default(value) {
  var id3 = this._id;
  return arguments.length ? this.each(easeConstant(id3, value)) : get2(this.node(), id3).ease;
}

// node_modules/d3-transition/src/transition/easeVarying.js
function easeVarying(id3, value) {
  return function() {
    var v = value.apply(this, arguments);
    if (typeof v !== "function") throw new Error();
    set2(this, id3).ease = v;
  };
}
function easeVarying_default(value) {
  if (typeof value !== "function") throw new Error();
  return this.each(easeVarying(this._id, value));
}

// node_modules/d3-transition/src/transition/filter.js
function filter_default2(match) {
  if (typeof match !== "function") match = matcher_default(match);
  for (var groups = this._groups, m = groups.length, subgroups = new Array(m), j = 0; j < m; ++j) {
    for (var group = groups[j], n = group.length, subgroup = subgroups[j] = [], node, i = 0; i < n; ++i) {
      if ((node = group[i]) && match.call(node, node.__data__, i, group)) {
        subgroup.push(node);
      }
    }
  }
  return new Transition(subgroups, this._parents, this._name, this._id);
}

// node_modules/d3-transition/src/transition/merge.js
function merge_default2(transition2) {
  if (transition2._id !== this._id) throw new Error();
  for (var groups0 = this._groups, groups1 = transition2._groups, m0 = groups0.length, m1 = groups1.length, m = Math.min(m0, m1), merges = new Array(m0), j = 0; j < m; ++j) {
    for (var group0 = groups0[j], group1 = groups1[j], n = group0.length, merge2 = merges[j] = new Array(n), node, i = 0; i < n; ++i) {
      if (node = group0[i] || group1[i]) {
        merge2[i] = node;
      }
    }
  }
  for (; j < m0; ++j) {
    merges[j] = groups0[j];
  }
  return new Transition(merges, this._parents, this._name, this._id);
}

// node_modules/d3-transition/src/transition/on.js
function start(name) {
  return (name + "").trim().split(/^|\s+/).every(function(t) {
    var i = t.indexOf(".");
    if (i >= 0) t = t.slice(0, i);
    return !t || t === "start";
  });
}
function onFunction(id3, name, listener) {
  var on0, on1, sit = start(name) ? init : set2;
  return function() {
    var schedule = sit(this, id3), on = schedule.on;
    if (on !== on0) (on1 = (on0 = on).copy()).on(name, listener);
    schedule.on = on1;
  };
}
function on_default2(name, listener) {
  var id3 = this._id;
  return arguments.length < 2 ? get2(this.node(), id3).on.on(name) : this.each(onFunction(id3, name, listener));
}

// node_modules/d3-transition/src/transition/remove.js
function removeFunction(id3) {
  return function() {
    var parent = this.parentNode;
    for (var i in this.__transition) if (+i !== id3) return;
    if (parent) parent.removeChild(this);
  };
}
function remove_default2() {
  return this.on("end.remove", removeFunction(this._id));
}

// node_modules/d3-transition/src/transition/select.js
function select_default3(select) {
  var name = this._name, id3 = this._id;
  if (typeof select !== "function") select = selector_default(select);
  for (var groups = this._groups, m = groups.length, subgroups = new Array(m), j = 0; j < m; ++j) {
    for (var group = groups[j], n = group.length, subgroup = subgroups[j] = new Array(n), node, subnode, i = 0; i < n; ++i) {
      if ((node = group[i]) && (subnode = select.call(node, node.__data__, i, group))) {
        if ("__data__" in node) subnode.__data__ = node.__data__;
        subgroup[i] = subnode;
        schedule_default(subgroup[i], name, id3, i, subgroup, get2(node, id3));
      }
    }
  }
  return new Transition(subgroups, this._parents, name, id3);
}

// node_modules/d3-transition/src/transition/selectAll.js
function selectAll_default3(select) {
  var name = this._name, id3 = this._id;
  if (typeof select !== "function") select = selectorAll_default(select);
  for (var groups = this._groups, m = groups.length, subgroups = [], parents = [], j = 0; j < m; ++j) {
    for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
      if (node = group[i]) {
        for (var children2 = select.call(node, node.__data__, i, group), child, inherit2 = get2(node, id3), k = 0, l = children2.length; k < l; ++k) {
          if (child = children2[k]) {
            schedule_default(child, name, id3, k, children2, inherit2);
          }
        }
        subgroups.push(children2);
        parents.push(node);
      }
    }
  }
  return new Transition(subgroups, parents, name, id3);
}

// node_modules/d3-transition/src/transition/selection.js
var Selection2 = selection_default.prototype.constructor;
function selection_default2() {
  return new Selection2(this._groups, this._parents);
}

// node_modules/d3-transition/src/transition/style.js
function styleNull(name, interpolate) {
  var string00, string10, interpolate0;
  return function() {
    var string0 = styleValue(this, name), string1 = (this.style.removeProperty(name), styleValue(this, name));
    return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : interpolate0 = interpolate(string00 = string0, string10 = string1);
  };
}
function styleRemove2(name) {
  return function() {
    this.style.removeProperty(name);
  };
}
function styleConstant2(name, interpolate, value1) {
  var string00, string1 = value1 + "", interpolate0;
  return function() {
    var string0 = styleValue(this, name);
    return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate(string00 = string0, value1);
  };
}
function styleFunction2(name, interpolate, value) {
  var string00, string10, interpolate0;
  return function() {
    var string0 = styleValue(this, name), value1 = value(this), string1 = value1 + "";
    if (value1 == null) string1 = value1 = (this.style.removeProperty(name), styleValue(this, name));
    return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate(string00 = string0, value1));
  };
}
function styleMaybeRemove(id3, name) {
  var on0, on1, listener0, key = "style." + name, event = "end." + key, remove2;
  return function() {
    var schedule = set2(this, id3), on = schedule.on, listener = schedule.value[key] == null ? remove2 || (remove2 = styleRemove2(name)) : void 0;
    if (on !== on0 || listener0 !== listener) (on1 = (on0 = on).copy()).on(event, listener0 = listener);
    schedule.on = on1;
  };
}
function style_default2(name, value, priority) {
  var i = (name += "") === "transform" ? interpolateTransformCss : interpolate_default;
  return value == null ? this.styleTween(name, styleNull(name, i)).on("end.style." + name, styleRemove2(name)) : typeof value === "function" ? this.styleTween(name, styleFunction2(name, i, tweenValue(this, "style." + name, value))).each(styleMaybeRemove(this._id, name)) : this.styleTween(name, styleConstant2(name, i, value), priority).on("end.style." + name, null);
}

// node_modules/d3-transition/src/transition/styleTween.js
function styleInterpolate(name, i, priority) {
  return function(t) {
    this.style.setProperty(name, i.call(this, t), priority);
  };
}
function styleTween(name, value, priority) {
  var t, i0;
  function tween() {
    var i = value.apply(this, arguments);
    if (i !== i0) t = (i0 = i) && styleInterpolate(name, i, priority);
    return t;
  }
  tween._value = value;
  return tween;
}
function styleTween_default(name, value, priority) {
  var key = "style." + (name += "");
  if (arguments.length < 2) return (key = this.tween(key)) && key._value;
  if (value == null) return this.tween(key, null);
  if (typeof value !== "function") throw new Error();
  return this.tween(key, styleTween(name, value, priority == null ? "" : priority));
}

// node_modules/d3-transition/src/transition/text.js
function textConstant2(value) {
  return function() {
    this.textContent = value;
  };
}
function textFunction2(value) {
  return function() {
    var value1 = value(this);
    this.textContent = value1 == null ? "" : value1;
  };
}
function text_default2(value) {
  return this.tween("text", typeof value === "function" ? textFunction2(tweenValue(this, "text", value)) : textConstant2(value == null ? "" : value + ""));
}

// node_modules/d3-transition/src/transition/textTween.js
function textInterpolate(i) {
  return function(t) {
    this.textContent = i.call(this, t);
  };
}
function textTween(value) {
  var t02, i0;
  function tween() {
    var i = value.apply(this, arguments);
    if (i !== i0) t02 = (i0 = i) && textInterpolate(i);
    return t02;
  }
  tween._value = value;
  return tween;
}
function textTween_default(value) {
  var key = "text";
  if (arguments.length < 1) return (key = this.tween(key)) && key._value;
  if (value == null) return this.tween(key, null);
  if (typeof value !== "function") throw new Error();
  return this.tween(key, textTween(value));
}

// node_modules/d3-transition/src/transition/transition.js
function transition_default() {
  var name = this._name, id0 = this._id, id1 = newId();
  for (var groups = this._groups, m = groups.length, j = 0; j < m; ++j) {
    for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
      if (node = group[i]) {
        var inherit2 = get2(node, id0);
        schedule_default(node, name, id1, i, group, {
          time: inherit2.time + inherit2.delay + inherit2.duration,
          delay: 0,
          duration: inherit2.duration,
          ease: inherit2.ease
        });
      }
    }
  }
  return new Transition(groups, this._parents, name, id1);
}

// node_modules/d3-transition/src/transition/end.js
function end_default() {
  var on0, on1, that = this, id3 = that._id, size = that.size();
  return new Promise(function(resolve, reject) {
    var cancel = { value: reject }, end = { value: function() {
      if (--size === 0) resolve();
    } };
    that.each(function() {
      var schedule = set2(this, id3), on = schedule.on;
      if (on !== on0) {
        on1 = (on0 = on).copy();
        on1._.cancel.push(cancel);
        on1._.interrupt.push(cancel);
        on1._.end.push(end);
      }
      schedule.on = on1;
    });
    if (size === 0) resolve();
  });
}

// node_modules/d3-transition/src/transition/index.js
var id = 0;
function Transition(groups, parents, name, id3) {
  this._groups = groups;
  this._parents = parents;
  this._name = name;
  this._id = id3;
}
function transition(name) {
  return selection_default().transition(name);
}
function newId() {
  return ++id;
}
var selection_prototype = selection_default.prototype;
Transition.prototype = transition.prototype = {
  constructor: Transition,
  select: select_default3,
  selectAll: selectAll_default3,
  selectChild: selection_prototype.selectChild,
  selectChildren: selection_prototype.selectChildren,
  filter: filter_default2,
  merge: merge_default2,
  selection: selection_default2,
  transition: transition_default,
  call: selection_prototype.call,
  nodes: selection_prototype.nodes,
  node: selection_prototype.node,
  size: selection_prototype.size,
  empty: selection_prototype.empty,
  each: selection_prototype.each,
  on: on_default2,
  attr: attr_default2,
  attrTween: attrTween_default,
  style: style_default2,
  styleTween: styleTween_default,
  text: text_default2,
  textTween: textTween_default,
  remove: remove_default2,
  tween: tween_default,
  delay: delay_default,
  duration: duration_default,
  ease: ease_default,
  easeVarying: easeVarying_default,
  end: end_default,
  [Symbol.iterator]: selection_prototype[Symbol.iterator]
};

// node_modules/d3-ease/src/cubic.js
function cubicInOut(t) {
  return ((t *= 2) <= 1 ? t * t * t : (t -= 2) * t * t + 2) / 2;
}

// node_modules/d3-ease/src/poly.js
var exponent = 3;
var polyIn = (function custom(e) {
  e = +e;
  function polyIn2(t) {
    return Math.pow(t, e);
  }
  polyIn2.exponent = custom;
  return polyIn2;
})(exponent);
var polyOut = (function custom2(e) {
  e = +e;
  function polyOut2(t) {
    return 1 - Math.pow(1 - t, e);
  }
  polyOut2.exponent = custom2;
  return polyOut2;
})(exponent);
var polyInOut = (function custom3(e) {
  e = +e;
  function polyInOut2(t) {
    return ((t *= 2) <= 1 ? Math.pow(t, e) : 2 - Math.pow(2 - t, e)) / 2;
  }
  polyInOut2.exponent = custom3;
  return polyInOut2;
})(exponent);

// node_modules/d3-ease/src/sin.js
var pi = Math.PI;
var halfPi = pi / 2;

// node_modules/d3-ease/src/math.js
function tpmt(x) {
  return (Math.pow(2, -10 * x) - 9765625e-10) * 1.0009775171065494;
}

// node_modules/d3-ease/src/bounce.js
var b1 = 4 / 11;
var b2 = 6 / 11;
var b3 = 8 / 11;
var b4 = 3 / 4;
var b5 = 9 / 11;
var b6 = 10 / 11;
var b7 = 15 / 16;
var b8 = 21 / 22;
var b9 = 63 / 64;
var b0 = 1 / b1 / b1;

// node_modules/d3-ease/src/back.js
var overshoot = 1.70158;
var backIn = (function custom4(s) {
  s = +s;
  function backIn2(t) {
    return (t = +t) * t * (s * (t - 1) + t);
  }
  backIn2.overshoot = custom4;
  return backIn2;
})(overshoot);
var backOut = (function custom5(s) {
  s = +s;
  function backOut2(t) {
    return --t * t * ((t + 1) * s + t) + 1;
  }
  backOut2.overshoot = custom5;
  return backOut2;
})(overshoot);
var backInOut = (function custom6(s) {
  s = +s;
  function backInOut2(t) {
    return ((t *= 2) < 1 ? t * t * ((s + 1) * t - s) : (t -= 2) * t * ((s + 1) * t + s) + 2) / 2;
  }
  backInOut2.overshoot = custom6;
  return backInOut2;
})(overshoot);

// node_modules/d3-ease/src/elastic.js
var tau = 2 * Math.PI;
var amplitude = 1;
var period = 0.3;
var elasticIn = (function custom7(a, p) {
  var s = Math.asin(1 / (a = Math.max(1, a))) * (p /= tau);
  function elasticIn2(t) {
    return a * tpmt(- --t) * Math.sin((s - t) / p);
  }
  elasticIn2.amplitude = function(a2) {
    return custom7(a2, p * tau);
  };
  elasticIn2.period = function(p2) {
    return custom7(a, p2);
  };
  return elasticIn2;
})(amplitude, period);
var elasticOut = (function custom8(a, p) {
  var s = Math.asin(1 / (a = Math.max(1, a))) * (p /= tau);
  function elasticOut2(t) {
    return 1 - a * tpmt(t = +t) * Math.sin((t + s) / p);
  }
  elasticOut2.amplitude = function(a2) {
    return custom8(a2, p * tau);
  };
  elasticOut2.period = function(p2) {
    return custom8(a, p2);
  };
  return elasticOut2;
})(amplitude, period);
var elasticInOut = (function custom9(a, p) {
  var s = Math.asin(1 / (a = Math.max(1, a))) * (p /= tau);
  function elasticInOut2(t) {
    return ((t = t * 2 - 1) < 0 ? a * tpmt(-t) * Math.sin((s - t) / p) : 2 - a * tpmt(t) * Math.sin((s + t) / p)) / 2;
  }
  elasticInOut2.amplitude = function(a2) {
    return custom9(a2, p * tau);
  };
  elasticInOut2.period = function(p2) {
    return custom9(a, p2);
  };
  return elasticInOut2;
})(amplitude, period);

// node_modules/d3-transition/src/selection/transition.js
var defaultTiming = {
  time: null,
  // Set on use.
  delay: 0,
  duration: 250,
  ease: cubicInOut
};
function inherit(node, id3) {
  var timing;
  while (!(timing = node.__transition) || !(timing = timing[id3])) {
    if (!(node = node.parentNode)) {
      throw new Error(`transition ${id3} not found`);
    }
  }
  return timing;
}
function transition_default2(name) {
  var id3, timing;
  if (name instanceof Transition) {
    id3 = name._id, name = name._name;
  } else {
    id3 = newId(), (timing = defaultTiming).time = now(), name = name == null ? null : name + "";
  }
  for (var groups = this._groups, m = groups.length, j = 0; j < m; ++j) {
    for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
      if (node = group[i]) {
        schedule_default(node, name, id3, i, group, timing || inherit(node, id3));
      }
    }
  }
  return new Transition(groups, this._parents, name, id3);
}

// node_modules/d3-transition/src/selection/index.js
selection_default.prototype.interrupt = interrupt_default2;
selection_default.prototype.transition = transition_default2;

// node_modules/d3-zoom/src/constant.js
var constant_default4 = (x) => () => x;

// node_modules/d3-zoom/src/event.js
function ZoomEvent(type, {
  sourceEvent,
  target,
  transform: transform2,
  dispatch: dispatch2
}) {
  Object.defineProperties(this, {
    type: { value: type, enumerable: true, configurable: true },
    sourceEvent: { value: sourceEvent, enumerable: true, configurable: true },
    target: { value: target, enumerable: true, configurable: true },
    transform: { value: transform2, enumerable: true, configurable: true },
    _: { value: dispatch2 }
  });
}

// node_modules/d3-zoom/src/transform.js
function Transform(k, x, y) {
  this.k = k;
  this.x = x;
  this.y = y;
}
Transform.prototype = {
  constructor: Transform,
  scale: function(k) {
    return k === 1 ? this : new Transform(this.k * k, this.x, this.y);
  },
  translate: function(x, y) {
    return x === 0 & y === 0 ? this : new Transform(this.k, this.x + this.k * x, this.y + this.k * y);
  },
  apply: function(point) {
    return [point[0] * this.k + this.x, point[1] * this.k + this.y];
  },
  applyX: function(x) {
    return x * this.k + this.x;
  },
  applyY: function(y) {
    return y * this.k + this.y;
  },
  invert: function(location) {
    return [(location[0] - this.x) / this.k, (location[1] - this.y) / this.k];
  },
  invertX: function(x) {
    return (x - this.x) / this.k;
  },
  invertY: function(y) {
    return (y - this.y) / this.k;
  },
  rescaleX: function(x) {
    return x.copy().domain(x.range().map(this.invertX, this).map(x.invert, x));
  },
  rescaleY: function(y) {
    return y.copy().domain(y.range().map(this.invertY, this).map(y.invert, y));
  },
  toString: function() {
    return "translate(" + this.x + "," + this.y + ") scale(" + this.k + ")";
  }
};
var identity2 = new Transform(1, 0, 0);
transform.prototype = Transform.prototype;
function transform(node) {
  while (!node.__zoom) if (!(node = node.parentNode)) return identity2;
  return node.__zoom;
}

// node_modules/d3-zoom/src/noevent.js
function nopropagation2(event) {
  event.stopImmediatePropagation();
}
function noevent_default2(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// node_modules/d3-zoom/src/zoom.js
function defaultFilter2(event) {
  return (!event.ctrlKey || event.type === "wheel") && !event.button;
}
function defaultExtent() {
  var e = this;
  if (e instanceof SVGElement) {
    e = e.ownerSVGElement || e;
    if (e.hasAttribute("viewBox")) {
      e = e.viewBox.baseVal;
      return [[e.x, e.y], [e.x + e.width, e.y + e.height]];
    }
    return [[0, 0], [e.width.baseVal.value, e.height.baseVal.value]];
  }
  return [[0, 0], [e.clientWidth, e.clientHeight]];
}
function defaultTransform() {
  return this.__zoom || identity2;
}
function defaultWheelDelta(event) {
  return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 2e-3) * (event.ctrlKey ? 10 : 1);
}
function defaultTouchable2() {
  return navigator.maxTouchPoints || "ontouchstart" in this;
}
function defaultConstrain(transform2, extent, translateExtent) {
  var dx0 = transform2.invertX(extent[0][0]) - translateExtent[0][0], dx1 = transform2.invertX(extent[1][0]) - translateExtent[1][0], dy0 = transform2.invertY(extent[0][1]) - translateExtent[0][1], dy1 = transform2.invertY(extent[1][1]) - translateExtent[1][1];
  return transform2.translate(
    dx1 > dx0 ? (dx0 + dx1) / 2 : Math.min(0, dx0) || Math.max(0, dx1),
    dy1 > dy0 ? (dy0 + dy1) / 2 : Math.min(0, dy0) || Math.max(0, dy1)
  );
}
function zoom_default2() {
  var filter3 = defaultFilter2, extent = defaultExtent, constrain = defaultConstrain, wheelDelta = defaultWheelDelta, touchable = defaultTouchable2, scaleExtent = [0, Infinity], translateExtent = [[-Infinity, -Infinity], [Infinity, Infinity]], duration = 250, interpolate = zoom_default, listeners = dispatch_default2("start", "zoom", "end"), touchstarting, touchfirst, touchending, touchDelay = 500, wheelDelay = 150, clickDistance2 = 0, tapDistance = 10;
  function zoom(selection2) {
    selection2.property("__zoom", defaultTransform).on("wheel.zoom", wheeled, { passive: false }).on("mousedown.zoom", mousedowned).on("dblclick.zoom", dblclicked).filter(touchable).on("touchstart.zoom", touchstarted).on("touchmove.zoom", touchmoved).on("touchend.zoom touchcancel.zoom", touchended).style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }
  zoom.transform = function(collection, transform2, point, event) {
    var selection2 = collection.selection ? collection.selection() : collection;
    selection2.property("__zoom", defaultTransform);
    if (collection !== selection2) {
      schedule(collection, transform2, point, event);
    } else {
      selection2.interrupt().each(function() {
        gesture(this, arguments).event(event).start().zoom(null, typeof transform2 === "function" ? transform2.apply(this, arguments) : transform2).end();
      });
    }
  };
  zoom.scaleBy = function(selection2, k, p, event) {
    zoom.scaleTo(selection2, function() {
      var k0 = this.__zoom.k, k1 = typeof k === "function" ? k.apply(this, arguments) : k;
      return k0 * k1;
    }, p, event);
  };
  zoom.scaleTo = function(selection2, k, p, event) {
    zoom.transform(selection2, function() {
      var e = extent.apply(this, arguments), t02 = this.__zoom, p0 = p == null ? centroid(e) : typeof p === "function" ? p.apply(this, arguments) : p, p1 = t02.invert(p0), k1 = typeof k === "function" ? k.apply(this, arguments) : k;
      return constrain(translate(scale(t02, k1), p0, p1), e, translateExtent);
    }, p, event);
  };
  zoom.translateBy = function(selection2, x, y, event) {
    zoom.transform(selection2, function() {
      return constrain(this.__zoom.translate(
        typeof x === "function" ? x.apply(this, arguments) : x,
        typeof y === "function" ? y.apply(this, arguments) : y
      ), extent.apply(this, arguments), translateExtent);
    }, null, event);
  };
  zoom.translateTo = function(selection2, x, y, p, event) {
    zoom.transform(selection2, function() {
      var e = extent.apply(this, arguments), t = this.__zoom, p0 = p == null ? centroid(e) : typeof p === "function" ? p.apply(this, arguments) : p;
      return constrain(identity2.translate(p0[0], p0[1]).scale(t.k).translate(
        typeof x === "function" ? -x.apply(this, arguments) : -x,
        typeof y === "function" ? -y.apply(this, arguments) : -y
      ), e, translateExtent);
    }, p, event);
  };
  function scale(transform2, k) {
    k = Math.max(scaleExtent[0], Math.min(scaleExtent[1], k));
    return k === transform2.k ? transform2 : new Transform(k, transform2.x, transform2.y);
  }
  function translate(transform2, p0, p1) {
    var x = p0[0] - p1[0] * transform2.k, y = p0[1] - p1[1] * transform2.k;
    return x === transform2.x && y === transform2.y ? transform2 : new Transform(transform2.k, x, y);
  }
  function centroid(extent2) {
    return [(+extent2[0][0] + +extent2[1][0]) / 2, (+extent2[0][1] + +extent2[1][1]) / 2];
  }
  function schedule(transition2, transform2, point, event) {
    transition2.on("start.zoom", function() {
      gesture(this, arguments).event(event).start();
    }).on("interrupt.zoom end.zoom", function() {
      gesture(this, arguments).event(event).end();
    }).tween("zoom", function() {
      var that = this, args = arguments, g = gesture(that, args).event(event), e = extent.apply(that, args), p = point == null ? centroid(e) : typeof point === "function" ? point.apply(that, args) : point, w = Math.max(e[1][0] - e[0][0], e[1][1] - e[0][1]), a = that.__zoom, b = typeof transform2 === "function" ? transform2.apply(that, args) : transform2, i = interpolate(a.invert(p).concat(w / a.k), b.invert(p).concat(w / b.k));
      return function(t) {
        if (t === 1) t = b;
        else {
          var l = i(t), k = w / l[2];
          t = new Transform(k, p[0] - l[0] * k, p[1] - l[1] * k);
        }
        g.zoom(null, t);
      };
    });
  }
  function gesture(that, args, clean) {
    return !clean && that.__zooming || new Gesture(that, args);
  }
  function Gesture(that, args) {
    this.that = that;
    this.args = args;
    this.active = 0;
    this.sourceEvent = null;
    this.extent = extent.apply(that, args);
    this.taps = 0;
  }
  Gesture.prototype = {
    event: function(event) {
      if (event) this.sourceEvent = event;
      return this;
    },
    start: function() {
      if (++this.active === 1) {
        this.that.__zooming = this;
        this.emit("start");
      }
      return this;
    },
    zoom: function(key, transform2) {
      if (this.mouse && key !== "mouse") this.mouse[1] = transform2.invert(this.mouse[0]);
      if (this.touch0 && key !== "touch") this.touch0[1] = transform2.invert(this.touch0[0]);
      if (this.touch1 && key !== "touch") this.touch1[1] = transform2.invert(this.touch1[0]);
      this.that.__zoom = transform2;
      this.emit("zoom");
      return this;
    },
    end: function() {
      if (--this.active === 0) {
        delete this.that.__zooming;
        this.emit("end");
      }
      return this;
    },
    emit: function(type) {
      var d = select_default2(this.that).datum();
      listeners.call(
        type,
        this.that,
        new ZoomEvent(type, {
          sourceEvent: this.sourceEvent,
          target: zoom,
          type,
          transform: this.that.__zoom,
          dispatch: listeners
        }),
        d
      );
    }
  };
  function wheeled(event, ...args) {
    if (!filter3.apply(this, arguments)) return;
    var g = gesture(this, args).event(event), t = this.__zoom, k = Math.max(scaleExtent[0], Math.min(scaleExtent[1], t.k * Math.pow(2, wheelDelta.apply(this, arguments)))), p = pointer_default(event);
    if (g.wheel) {
      if (g.mouse[0][0] !== p[0] || g.mouse[0][1] !== p[1]) {
        g.mouse[1] = t.invert(g.mouse[0] = p);
      }
      clearTimeout(g.wheel);
    } else if (t.k === k) return;
    else {
      g.mouse = [p, t.invert(p)];
      interrupt_default(this);
      g.start();
    }
    noevent_default2(event);
    g.wheel = setTimeout(wheelidled, wheelDelay);
    g.zoom("mouse", constrain(translate(scale(t, k), g.mouse[0], g.mouse[1]), g.extent, translateExtent));
    function wheelidled() {
      g.wheel = null;
      g.end();
    }
  }
  function mousedowned(event, ...args) {
    if (touchending || !filter3.apply(this, arguments)) return;
    var currentTarget = event.currentTarget, g = gesture(this, args, true).event(event), v = select_default2(event.view).on("mousemove.zoom", mousemoved, true).on("mouseup.zoom", mouseupped, true), p = pointer_default(event, currentTarget), x0 = event.clientX, y0 = event.clientY;
    nodrag_default(event.view);
    nopropagation2(event);
    g.mouse = [p, this.__zoom.invert(p)];
    interrupt_default(this);
    g.start();
    function mousemoved(event2) {
      noevent_default2(event2);
      if (!g.moved) {
        var dx = event2.clientX - x0, dy = event2.clientY - y0;
        g.moved = dx * dx + dy * dy > clickDistance2;
      }
      g.event(event2).zoom("mouse", constrain(translate(g.that.__zoom, g.mouse[0] = pointer_default(event2, currentTarget), g.mouse[1]), g.extent, translateExtent));
    }
    function mouseupped(event2) {
      v.on("mousemove.zoom mouseup.zoom", null);
      yesdrag(event2.view, g.moved);
      noevent_default2(event2);
      g.event(event2).end();
    }
  }
  function dblclicked(event, ...args) {
    if (!filter3.apply(this, arguments)) return;
    var t02 = this.__zoom, p0 = pointer_default(event.changedTouches ? event.changedTouches[0] : event, this), p1 = t02.invert(p0), k1 = t02.k * (event.shiftKey ? 0.5 : 2), t12 = constrain(translate(scale(t02, k1), p0, p1), extent.apply(this, args), translateExtent);
    noevent_default2(event);
    if (duration > 0) select_default2(this).transition().duration(duration).call(schedule, t12, p0, event);
    else select_default2(this).call(zoom.transform, t12, p0, event);
  }
  function touchstarted(event, ...args) {
    if (!filter3.apply(this, arguments)) return;
    var touches = event.touches, n = touches.length, g = gesture(this, args, event.changedTouches.length === n).event(event), started, i, t, p;
    nopropagation2(event);
    for (i = 0; i < n; ++i) {
      t = touches[i], p = pointer_default(t, this);
      p = [p, this.__zoom.invert(p), t.identifier];
      if (!g.touch0) g.touch0 = p, started = true, g.taps = 1 + !!touchstarting;
      else if (!g.touch1 && g.touch0[2] !== p[2]) g.touch1 = p, g.taps = 0;
    }
    if (touchstarting) touchstarting = clearTimeout(touchstarting);
    if (started) {
      if (g.taps < 2) touchfirst = p[0], touchstarting = setTimeout(function() {
        touchstarting = null;
      }, touchDelay);
      interrupt_default(this);
      g.start();
    }
  }
  function touchmoved(event, ...args) {
    if (!this.__zooming) return;
    var g = gesture(this, args).event(event), touches = event.changedTouches, n = touches.length, i, t, p, l;
    noevent_default2(event);
    for (i = 0; i < n; ++i) {
      t = touches[i], p = pointer_default(t, this);
      if (g.touch0 && g.touch0[2] === t.identifier) g.touch0[0] = p;
      else if (g.touch1 && g.touch1[2] === t.identifier) g.touch1[0] = p;
    }
    t = g.that.__zoom;
    if (g.touch1) {
      var p0 = g.touch0[0], l0 = g.touch0[1], p1 = g.touch1[0], l1 = g.touch1[1], dp = (dp = p1[0] - p0[0]) * dp + (dp = p1[1] - p0[1]) * dp, dl = (dl = l1[0] - l0[0]) * dl + (dl = l1[1] - l0[1]) * dl;
      t = scale(t, Math.sqrt(dp / dl));
      p = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      l = [(l0[0] + l1[0]) / 2, (l0[1] + l1[1]) / 2];
    } else if (g.touch0) p = g.touch0[0], l = g.touch0[1];
    else return;
    g.zoom("touch", constrain(translate(t, p, l), g.extent, translateExtent));
  }
  function touchended(event, ...args) {
    if (!this.__zooming) return;
    var g = gesture(this, args).event(event), touches = event.changedTouches, n = touches.length, i, t;
    nopropagation2(event);
    if (touchending) clearTimeout(touchending);
    touchending = setTimeout(function() {
      touchending = null;
    }, touchDelay);
    for (i = 0; i < n; ++i) {
      t = touches[i];
      if (g.touch0 && g.touch0[2] === t.identifier) delete g.touch0;
      else if (g.touch1 && g.touch1[2] === t.identifier) delete g.touch1;
    }
    if (g.touch1 && !g.touch0) g.touch0 = g.touch1, delete g.touch1;
    if (g.touch0) g.touch0[1] = this.__zoom.invert(g.touch0[0]);
    else {
      g.end();
      if (g.taps === 2) {
        t = pointer_default(t, this);
        if (Math.hypot(touchfirst[0] - t[0], touchfirst[1] - t[1]) < tapDistance) {
          var p = select_default2(this).on("dblclick.zoom");
          if (p) p.apply(this, arguments);
        }
      }
    }
  }
  zoom.wheelDelta = function(_) {
    return arguments.length ? (wheelDelta = typeof _ === "function" ? _ : constant_default4(+_), zoom) : wheelDelta;
  };
  zoom.filter = function(_) {
    return arguments.length ? (filter3 = typeof _ === "function" ? _ : constant_default4(!!_), zoom) : filter3;
  };
  zoom.touchable = function(_) {
    return arguments.length ? (touchable = typeof _ === "function" ? _ : constant_default4(!!_), zoom) : touchable;
  };
  zoom.extent = function(_) {
    return arguments.length ? (extent = typeof _ === "function" ? _ : constant_default4([[+_[0][0], +_[0][1]], [+_[1][0], +_[1][1]]]), zoom) : extent;
  };
  zoom.scaleExtent = function(_) {
    return arguments.length ? (scaleExtent[0] = +_[0], scaleExtent[1] = +_[1], zoom) : [scaleExtent[0], scaleExtent[1]];
  };
  zoom.translateExtent = function(_) {
    return arguments.length ? (translateExtent[0][0] = +_[0][0], translateExtent[1][0] = +_[1][0], translateExtent[0][1] = +_[0][1], translateExtent[1][1] = +_[1][1], zoom) : [[translateExtent[0][0], translateExtent[0][1]], [translateExtent[1][0], translateExtent[1][1]]];
  };
  zoom.constrain = function(_) {
    return arguments.length ? (constrain = _, zoom) : constrain;
  };
  zoom.duration = function(_) {
    return arguments.length ? (duration = +_, zoom) : duration;
  };
  zoom.interpolate = function(_) {
    return arguments.length ? (interpolate = _, zoom) : interpolate;
  };
  zoom.on = function() {
    var value = listeners.on.apply(listeners, arguments);
    return value === listeners ? zoom : value;
  };
  zoom.clickDistance = function(_) {
    return arguments.length ? (clickDistance2 = (_ = +_) * _, zoom) : Math.sqrt(clickDistance2);
  };
  zoom.tapDistance = function(_) {
    return arguments.length ? (tapDistance = +_, zoom) : tapDistance;
  };
  return zoom;
}

// node_modules/ngx-vflow/fesm2022/ngx-vflow.mjs
var _c0 = ["edgeLabelWrapper"];
var _c1 = ["edgeLabel", ""];
function EdgeLabelComponent_Conditional_0_Conditional_0_Conditional_0_ng_container_3_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵelementContainer(0);
  }
}
function EdgeLabelComponent_Conditional_0_Conditional_0_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "foreignObject");
    ɵɵnamespaceHTML();
    ɵɵelementStart(1, "div", 1, 0);
    ɵɵtemplate(3, EdgeLabelComponent_Conditional_0_Conditional_0_Conditional_0_ng_container_3_Template, 1, 0, "ng-container", 2);
    ɵɵelementEnd()();
  }
  if (rf & 2) {
    const model_r1 = ɵɵnextContext(2);
    const ctx_r1 = ɵɵnextContext();
    ɵɵattribute("x", ctx_r1.edgeLabelPoint().x)("y", ctx_r1.edgeLabelPoint().y)("width", model_r1.size().width)("height", model_r1.size().height);
    ɵɵadvance(3);
    ɵɵproperty("ngTemplateOutlet", ctx)("ngTemplateOutletContext", ctx_r1.getLabelContext());
  }
}
function EdgeLabelComponent_Conditional_0_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, EdgeLabelComponent_Conditional_0_Conditional_0_Conditional_0_Template, 4, 6, ":svg:foreignObject");
  }
  if (rf & 2) {
    let tmp_3_0;
    const ctx_r1 = ɵɵnextContext(2);
    ɵɵconditional((tmp_3_0 = ctx_r1.htmlTemplate()) ? 0 : -1, tmp_3_0);
  }
}
function EdgeLabelComponent_Conditional_0_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "foreignObject");
    ɵɵnamespaceHTML();
    ɵɵelementStart(1, "div", 1, 0);
    ɵɵtext(3);
    ɵɵelementEnd()();
  }
  if (rf & 2) {
    const model_r1 = ɵɵnextContext();
    const ctx_r1 = ɵɵnextContext();
    ɵɵattribute("x", ctx_r1.edgeLabelPoint().x)("y", ctx_r1.edgeLabelPoint().y)("width", model_r1.size().width)("height", model_r1.size().height);
    ɵɵadvance();
    ɵɵstyleMap(ctx_r1.edgeLabelStyle());
    ɵɵadvance(2);
    ɵɵtextInterpolate1(" ", model_r1.edgeLabel.text, " ");
  }
}
function EdgeLabelComponent_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, EdgeLabelComponent_Conditional_0_Conditional_0_Template, 1, 1);
    ɵɵconditionalCreate(1, EdgeLabelComponent_Conditional_0_Conditional_1_Template, 4, 7, ":svg:foreignObject");
  }
  if (rf & 2) {
    const model_r1 = ctx;
    const ctx_r1 = ɵɵnextContext();
    ɵɵconditional(model_r1.edgeLabel.type === "html-template" && ctx_r1.htmlTemplate() ? 0 : -1);
    ɵɵadvance();
    ɵɵconditional(model_r1.edgeLabel.type === "default" ? 1 : -1);
  }
}
var _c2 = ["edge", ""];
function EdgeComponent_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelement(0, "path", 0);
    ɵɵelementStart(1, "path", 1);
    ɵɵlistener("click", function EdgeComponent_Conditional_0_Template_path_click_1_listener() {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      ctx_r1.select();
      return ɵɵresetView(ctx_r1.pull());
    });
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵclassProp("edge_selected", ctx_r1.model().selected());
    ɵɵattribute("d", ctx_r1.model().path().path)("marker-start", ctx_r1.model().markerStartUrl())("marker-end", ctx_r1.model().markerEndUrl());
    ɵɵadvance();
    ɵɵattribute("d", ctx_r1.model().path().path);
  }
}
function EdgeComponent_Conditional_1_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵelementContainer(0, 2);
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext(2);
    ɵɵproperty("ngTemplateOutlet", ctx)("ngTemplateOutletContext", ctx_r1.model().context)("ngTemplateOutletInjector", ctx_r1.injector);
  }
}
function EdgeComponent_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, EdgeComponent_Conditional_1_Conditional_0_Template, 1, 3, "ng-container", 2);
  }
  if (rf & 2) {
    let tmp_1_0;
    const ctx_r1 = ɵɵnextContext();
    ɵɵconditional((tmp_1_0 = ctx_r1.edgeTemplate()) ? 0 : -1, tmp_1_0);
  }
}
function EdgeComponent_Conditional_2_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "g", 3);
  }
  if (rf & 2) {
    const label_r3 = ɵɵnextContext();
    const ctx_r1 = ɵɵnextContext();
    ɵɵproperty("model", label_r3)("point", ctx)("edgeModel", ctx_r1.model())("htmlTemplate", ctx_r1.edgeLabelHtmlTemplate());
  }
}
function EdgeComponent_Conditional_2_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, EdgeComponent_Conditional_2_Conditional_0_Template, 1, 4, ":svg:g", 3);
  }
  if (rf & 2) {
    let tmp_2_0;
    const ctx_r1 = ɵɵnextContext();
    ɵɵconditional((tmp_2_0 = (tmp_2_0 = ctx_r1.model().path().labelPoints) == null ? null : tmp_2_0.start) ? 0 : -1, tmp_2_0);
  }
}
function EdgeComponent_Conditional_3_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "g", 3);
  }
  if (rf & 2) {
    const label_r4 = ɵɵnextContext();
    const ctx_r1 = ɵɵnextContext();
    ɵɵproperty("model", label_r4)("point", ctx)("edgeModel", ctx_r1.model())("htmlTemplate", ctx_r1.edgeLabelHtmlTemplate());
  }
}
function EdgeComponent_Conditional_3_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, EdgeComponent_Conditional_3_Conditional_0_Template, 1, 4, ":svg:g", 3);
  }
  if (rf & 2) {
    let tmp_2_0;
    const ctx_r1 = ɵɵnextContext();
    ɵɵconditional((tmp_2_0 = (tmp_2_0 = ctx_r1.model().path().labelPoints) == null ? null : tmp_2_0.center) ? 0 : -1, tmp_2_0);
  }
}
function EdgeComponent_Conditional_4_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "g", 3);
  }
  if (rf & 2) {
    const label_r5 = ɵɵnextContext();
    const ctx_r1 = ɵɵnextContext();
    ɵɵproperty("model", label_r5)("point", ctx)("edgeModel", ctx_r1.model())("htmlTemplate", ctx_r1.edgeLabelHtmlTemplate());
  }
}
function EdgeComponent_Conditional_4_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, EdgeComponent_Conditional_4_Conditional_0_Template, 1, 4, ":svg:g", 3);
  }
  if (rf & 2) {
    let tmp_2_0;
    const ctx_r1 = ɵɵnextContext();
    ɵɵconditional((tmp_2_0 = (tmp_2_0 = ctx_r1.model().path().labelPoints) == null ? null : tmp_2_0.end) ? 0 : -1, tmp_2_0);
  }
}
function EdgeComponent_Conditional_5_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    const _r6 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "circle", 5);
    ɵɵlistener("pointerStart", function EdgeComponent_Conditional_5_Conditional_0_Template_circle_pointerStart_0_listener($event) {
      ɵɵrestoreView(_r6);
      const ctx_r1 = ɵɵnextContext(2);
      return ɵɵresetView(ctx_r1.startReconnection($event, ctx_r1.model().targetHandle()));
    });
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext(2);
    ɵɵattribute("cx", ctx_r1.model().sourceHandle().pointAbsolute().x)("cy", ctx_r1.model().sourceHandle().pointAbsolute().y);
  }
}
function EdgeComponent_Conditional_5_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    const _r7 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "circle", 5);
    ɵɵlistener("pointerStart", function EdgeComponent_Conditional_5_Conditional_1_Template_circle_pointerStart_0_listener($event) {
      ɵɵrestoreView(_r7);
      const ctx_r1 = ɵɵnextContext(2);
      return ɵɵresetView(ctx_r1.startReconnection($event, ctx_r1.model().sourceHandle()));
    });
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext(2);
    ɵɵattribute("cx", ctx_r1.model().targetHandle().pointAbsolute().x)("cy", ctx_r1.model().targetHandle().pointAbsolute().y);
  }
}
function EdgeComponent_Conditional_5_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, EdgeComponent_Conditional_5_Conditional_0_Template, 1, 2, ":svg:circle", 4);
    ɵɵconditionalCreate(1, EdgeComponent_Conditional_5_Conditional_1_Template, 1, 2, ":svg:circle", 4);
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵconditional(ctx_r1.model().reconnectable === true || ctx_r1.model().reconnectable === "source" ? 0 : -1);
    ɵɵadvance();
    ɵɵconditional(ctx_r1.model().reconnectable === true || ctx_r1.model().reconnectable === "target" ? 1 : -1);
  }
}
var _c3 = ["*"];
var _c4 = ["resizer"];
var _c5 = ["resizable", ""];
function ResizableComponent_ng_template_0_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "g")(1, "line", 1);
    ɵɵlistener("pointerStart", function ResizableComponent_ng_template_0_Template_line_pointerStart_1_listener($event) {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.startResize("top", $event));
    });
    ɵɵelementEnd();
    ɵɵelementStart(2, "line", 2);
    ɵɵlistener("pointerStart", function ResizableComponent_ng_template_0_Template_line_pointerStart_2_listener($event) {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.startResize("left", $event));
    });
    ɵɵelementEnd();
    ɵɵelementStart(3, "line", 3);
    ɵɵlistener("pointerStart", function ResizableComponent_ng_template_0_Template_line_pointerStart_3_listener($event) {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.startResize("bottom", $event));
    });
    ɵɵelementEnd();
    ɵɵelementStart(4, "line", 4);
    ɵɵlistener("pointerStart", function ResizableComponent_ng_template_0_Template_line_pointerStart_4_listener($event) {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.startResize("right", $event));
    });
    ɵɵelementEnd();
    ɵɵelementStart(5, "rect", 5);
    ɵɵlistener("pointerStart", function ResizableComponent_ng_template_0_Template_rect_pointerStart_5_listener($event) {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.startResize("top-left", $event));
    });
    ɵɵelementEnd();
    ɵɵelementStart(6, "rect", 6);
    ɵɵlistener("pointerStart", function ResizableComponent_ng_template_0_Template_rect_pointerStart_6_listener($event) {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.startResize("top-right", $event));
    });
    ɵɵelementEnd();
    ɵɵelementStart(7, "rect", 7);
    ɵɵlistener("pointerStart", function ResizableComponent_ng_template_0_Template_rect_pointerStart_7_listener($event) {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.startResize("bottom-left", $event));
    });
    ɵɵelementEnd();
    ɵɵelementStart(8, "rect", 8);
    ɵɵlistener("pointerStart", function ResizableComponent_ng_template_0_Template_rect_pointerStart_8_listener($event) {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.startResize("bottom-right", $event));
    });
    ɵɵelementEnd()();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵadvance();
    ɵɵattribute("x1", ctx_r1.lineGap)("y1", -ctx_r1.gap())("x2", ctx_r1.model.size().width - ctx_r1.lineGap)("y2", -ctx_r1.gap())("stroke", ctx_r1.resizerColor());
    ɵɵadvance();
    ɵɵattribute("x1", -ctx_r1.gap())("y1", ctx_r1.lineGap)("x2", -ctx_r1.gap())("y2", ctx_r1.model.size().height - ctx_r1.lineGap)("stroke", ctx_r1.resizerColor());
    ɵɵadvance();
    ɵɵattribute("x1", ctx_r1.lineGap)("y1", ctx_r1.model.size().height + ctx_r1.gap())("x2", ctx_r1.model.size().width - ctx_r1.lineGap)("y2", ctx_r1.model.size().height + ctx_r1.gap())("stroke", ctx_r1.resizerColor());
    ɵɵadvance();
    ɵɵattribute("x1", ctx_r1.model.size().width + ctx_r1.gap())("y1", ctx_r1.lineGap)("x2", ctx_r1.model.size().width + ctx_r1.gap())("y2", ctx_r1.model.size().height - ctx_r1.lineGap)("stroke", ctx_r1.resizerColor());
    ɵɵadvance();
    ɵɵattribute("x", -(ctx_r1.handleSize / 2) - ctx_r1.gap())("y", -(ctx_r1.handleSize / 2) - ctx_r1.gap())("width", ctx_r1.handleSize)("height", ctx_r1.handleSize)("fill", ctx_r1.resizerColor());
    ɵɵadvance();
    ɵɵattribute("x", ctx_r1.model.size().width - ctx_r1.handleSize / 2 + ctx_r1.gap())("y", -(ctx_r1.handleSize / 2) - ctx_r1.gap())("width", ctx_r1.handleSize)("height", ctx_r1.handleSize)("fill", ctx_r1.resizerColor());
    ɵɵadvance();
    ɵɵattribute("x", -(ctx_r1.handleSize / 2) - ctx_r1.gap())("y", ctx_r1.model.size().height - ctx_r1.handleSize / 2 + ctx_r1.gap())("width", ctx_r1.handleSize)("height", ctx_r1.handleSize)("fill", ctx_r1.resizerColor());
    ɵɵadvance();
    ɵɵattribute("x", ctx_r1.model.size().width - ctx_r1.handleSize / 2 + ctx_r1.gap())("y", ctx_r1.model.size().height - ctx_r1.handleSize / 2 + ctx_r1.gap())("width", ctx_r1.handleSize)("height", ctx_r1.handleSize)("fill", ctx_r1.resizerColor());
  }
}
var _c6 = ["node", ""];
function NodeComponent_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "foreignObject", 3);
    ɵɵlistener("click", function NodeComponent_Conditional_0_Template_foreignObject_click_0_listener() {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      ctx_r1.pullNode();
      return ɵɵresetView(ctx_r1.selectNode());
    });
    ɵɵnamespaceHTML();
    ɵɵelementStart(1, "default-node", 4);
    ɵɵelement(2, "div", 5)(3, "handle", 6)(4, "handle", 7);
    ɵɵelementEnd()();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵattribute("width", ctx_r1.model().foWidth())("height", ctx_r1.model().foHeight());
    ɵɵadvance();
    ɵɵstyleProp("width", ctx_r1.model().styleWidth())("height", ctx_r1.model().styleHeight())("max-width", ctx_r1.model().styleWidth())("max-height", ctx_r1.model().styleHeight());
    ɵɵproperty("selected", ctx_r1.model().selected());
    ɵɵadvance();
    ɵɵproperty("outerHTML", ctx_r1.model().text(), ɵɵsanitizeHtml);
  }
}
function NodeComponent_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    const _r3 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "foreignObject", 3);
    ɵɵlistener("click", function NodeComponent_Conditional_1_Template_foreignObject_click_0_listener() {
      ɵɵrestoreView(_r3);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.pullNode());
    });
    ɵɵnamespaceHTML();
    ɵɵelementStart(1, "div", 8);
    ɵɵelementContainer(2, 9);
    ɵɵelementEnd()();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵattribute("width", ctx_r1.model().foWidth())("height", ctx_r1.model().foHeight());
    ɵɵadvance();
    ɵɵstyleProp("width", ctx_r1.model().styleWidth())("height", ctx_r1.model().styleHeight());
    ɵɵadvance();
    ɵɵproperty("ngTemplateOutlet", ctx_r1.nodeTemplate() ?? null)("ngTemplateOutletContext", ctx_r1.model().context)("ngTemplateOutletInjector", ctx_r1.injector);
  }
}
function NodeComponent_Conditional_2_Template(rf, ctx) {
  if (rf & 1) {
    const _r4 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "g", 10);
    ɵɵlistener("click", function NodeComponent_Conditional_2_Template_g_click_0_listener() {
      ɵɵrestoreView(_r4);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.pullNode());
    });
    ɵɵelementContainer(1, 9);
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵadvance();
    ɵɵproperty("ngTemplateOutlet", ctx_r1.nodeSvgTemplate() ?? null)("ngTemplateOutletContext", ctx_r1.model().context)("ngTemplateOutletInjector", ctx_r1.injector);
  }
}
function NodeComponent_Conditional_3_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    const _r5 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "foreignObject", 3);
    ɵɵlistener("click", function NodeComponent_Conditional_3_Conditional_0_Template_foreignObject_click_0_listener() {
      ɵɵrestoreView(_r5);
      const ctx_r1 = ɵɵnextContext(2);
      return ɵɵresetView(ctx_r1.pullNode());
    });
    ɵɵnamespaceHTML();
    ɵɵelementStart(1, "div", 8);
    ɵɵelementContainer(2, 11);
    ɵɵelementEnd()();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext(2);
    ɵɵattribute("width", ctx_r1.model().foWidth())("height", ctx_r1.model().foHeight());
    ɵɵadvance();
    ɵɵstyleProp("width", ctx_r1.model().styleWidth())("height", ctx_r1.model().styleHeight());
    ɵɵadvance();
    ɵɵproperty("ngComponentOutlet", ctx)("ngComponentOutletInputs", ctx_r1.model().componentTypeInputs)("ngComponentOutletInjector", ctx_r1.injector);
  }
}
function NodeComponent_Conditional_3_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, NodeComponent_Conditional_3_Conditional_0_Template, 3, 9, ":svg:foreignObject", 0);
    ɵɵpipe(1, "async");
  }
  if (rf & 2) {
    let tmp_1_0;
    const ctx_r1 = ɵɵnextContext();
    ɵɵconditional((tmp_1_0 = ɵɵpipeBind1(1, 1, ctx_r1.model().componentInstance$)) ? 0 : -1, tmp_1_0);
  }
}
function NodeComponent_Conditional_4_Template(rf, ctx) {
  if (rf & 1) {
    const _r6 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "rect", 12);
    ɵɵlistener("click", function NodeComponent_Conditional_4_Template_rect_click_0_listener() {
      ɵɵrestoreView(_r6);
      const ctx_r1 = ɵɵnextContext();
      ctx_r1.pullNode();
      return ɵɵresetView(ctx_r1.selectNode());
    });
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵstyleProp("stroke", ctx_r1.model().color())("fill", ctx_r1.model().color());
    ɵɵclassProp("default-group-node_selected", ctx_r1.model().selected());
    ɵɵproperty("resizable", ctx_r1.model().resizable())("gap", 3)("resizerColor", ctx_r1.model().color());
    ɵɵattribute("width", ctx_r1.model().size().width)("height", ctx_r1.model().size().height);
  }
}
function NodeComponent_Conditional_5_Template(rf, ctx) {
  if (rf & 1) {
    const _r7 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "g", 10);
    ɵɵlistener("click", function NodeComponent_Conditional_5_Template_g_click_0_listener() {
      ɵɵrestoreView(_r7);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.pullNode());
    });
    ɵɵelementContainer(1, 9);
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵadvance();
    ɵɵproperty("ngTemplateOutlet", ctx_r1.groupNodeTemplate() ?? null)("ngTemplateOutletContext", ctx_r1.model().context)("ngTemplateOutletInjector", ctx_r1.injector);
  }
}
function NodeComponent_Conditional_6_Conditional_0_ng_template_0_Template(rf, ctx) {
}
function NodeComponent_Conditional_6_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵtemplate(0, NodeComponent_Conditional_6_Conditional_0_ng_template_0_Template, 0, 0, "ng-template", 13);
  }
  if (rf & 2) {
    const template_r8 = ɵɵnextContext();
    ɵɵproperty("ngTemplateOutlet", template_r8);
  }
}
function NodeComponent_Conditional_6_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, NodeComponent_Conditional_6_Conditional_0_Template, 1, 1, null, 13);
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵconditional(ctx_r1.model().resizable() ? 0 : -1);
  }
}
function NodeComponent_For_8_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    const _r9 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "circle", 17);
    ɵɵlistener("pointerStart", function NodeComponent_For_8_Conditional_0_Template_circle_pointerStart_0_listener($event) {
      ɵɵrestoreView(_r9);
      const handle_r10 = ɵɵnextContext().$implicit;
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.startConnection($event, handle_r10));
    })("pointerEnd", function NodeComponent_For_8_Conditional_0_Template_circle_pointerEnd_0_listener() {
      ɵɵrestoreView(_r9);
      const ctx_r1 = ɵɵnextContext(2);
      return ɵɵresetView(ctx_r1.endConnection());
    });
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const handle_r10 = ɵɵnextContext().$implicit;
    ɵɵattribute("cx", handle_r10.hostOffset().x)("cy", handle_r10.hostOffset().y)("stroke-width", handle_r10.strokeWidth);
  }
}
function NodeComponent_For_8_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    const _r11 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "g", 18);
    ɵɵlistener("pointerStart", function NodeComponent_For_8_Conditional_1_Template_g_pointerStart_0_listener($event) {
      ɵɵrestoreView(_r11);
      const handle_r10 = ɵɵnextContext().$implicit;
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.startConnection($event, handle_r10));
    })("pointerEnd", function NodeComponent_For_8_Conditional_1_Template_g_pointerEnd_0_listener() {
      ɵɵrestoreView(_r11);
      const ctx_r1 = ɵɵnextContext(2);
      return ɵɵresetView(ctx_r1.endConnection());
    });
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const handle_r10 = ɵɵnextContext().$implicit;
    ɵɵproperty("handleSizeController", handle_r10);
  }
}
function NodeComponent_For_8_Conditional_2__svg_ng_container_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelementContainer(0);
  }
}
function NodeComponent_For_8_Conditional_2_Template(rf, ctx) {
  if (rf & 1) {
    const _r12 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "g", 18);
    ɵɵlistener("pointerStart", function NodeComponent_For_8_Conditional_2_Template_g_pointerStart_0_listener($event) {
      ɵɵrestoreView(_r12);
      const handle_r10 = ɵɵnextContext().$implicit;
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.startConnection($event, handle_r10));
    })("pointerEnd", function NodeComponent_For_8_Conditional_2_Template_g_pointerEnd_0_listener() {
      ɵɵrestoreView(_r12);
      const ctx_r1 = ɵɵnextContext(2);
      return ɵɵresetView(ctx_r1.endConnection());
    });
    ɵɵtemplate(1, NodeComponent_For_8_Conditional_2__svg_ng_container_1_Template, 1, 0, "ng-container", 19);
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const handle_r10 = ɵɵnextContext().$implicit;
    ɵɵproperty("handleSizeController", handle_r10);
    ɵɵadvance();
    ɵɵproperty("ngTemplateOutlet", handle_r10.template)("ngTemplateOutletContext", handle_r10.templateContext);
  }
}
function NodeComponent_For_8_Conditional_3_Template(rf, ctx) {
  if (rf & 1) {
    const _r13 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "circle", 20);
    ɵɵlistener("pointerEnd", function NodeComponent_For_8_Conditional_3_Template_circle_pointerEnd_0_listener() {
      ɵɵrestoreView(_r13);
      const handle_r10 = ɵɵnextContext().$implicit;
      const ctx_r1 = ɵɵnextContext();
      ctx_r1.endConnection();
      return ɵɵresetView(ctx_r1.resetValidateConnection(handle_r10));
    })("pointerOver", function NodeComponent_For_8_Conditional_3_Template_circle_pointerOver_0_listener() {
      ɵɵrestoreView(_r13);
      const handle_r10 = ɵɵnextContext().$implicit;
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.validateConnection(handle_r10));
    })("pointerOut", function NodeComponent_For_8_Conditional_3_Template_circle_pointerOut_0_listener() {
      ɵɵrestoreView(_r13);
      const handle_r10 = ɵɵnextContext().$implicit;
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.resetValidateConnection(handle_r10));
    });
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const handle_r10 = ɵɵnextContext().$implicit;
    const ctx_r1 = ɵɵnextContext();
    ɵɵattribute("r", ctx_r1.model().magnetRadius)("cx", handle_r10.hostOffset().x)("cy", handle_r10.hostOffset().y);
  }
}
function NodeComponent_For_8_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, NodeComponent_For_8_Conditional_0_Template, 1, 3, ":svg:circle", 14);
    ɵɵconditionalCreate(1, NodeComponent_For_8_Conditional_1_Template, 1, 1, ":svg:g", 15);
    ɵɵconditionalCreate(2, NodeComponent_For_8_Conditional_2_Template, 2, 3, ":svg:g", 15);
    ɵɵconditionalCreate(3, NodeComponent_For_8_Conditional_3_Template, 1, 3, ":svg:circle", 16);
  }
  if (rf & 2) {
    const handle_r10 = ctx.$implicit;
    const ctx_r1 = ɵɵnextContext();
    ɵɵconditional(handle_r10.template === void 0 ? 0 : -1);
    ɵɵadvance();
    ɵɵconditional(handle_r10.template === null ? 1 : -1);
    ɵɵadvance();
    ɵɵconditional(handle_r10.template ? 2 : -1);
    ɵɵadvance();
    ɵɵconditional(ctx_r1.showMagnet() ? 3 : -1);
  }
}
function NodeComponent_For_10_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "foreignObject");
    ɵɵnamespaceHTML();
    ɵɵelementContainer(1, 13);
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const toolbar_r14 = ctx.$implicit;
    ɵɵattribute("width", toolbar_r14.size().width)("height", toolbar_r14.size().height)("transform", toolbar_r14.transform());
    ɵɵadvance();
    ɵɵproperty("ngTemplateOutlet", toolbar_r14.template());
  }
}
var _c7 = ["connection", ""];
function ConnectionComponent_Conditional_0_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "path", 0);
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext(2);
    ɵɵattribute("d", ctx)("marker-end", ctx_r0.markerUrl())("stroke", ctx_r0.defaultColor);
  }
}
function ConnectionComponent_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, ConnectionComponent_Conditional_0_Conditional_0_Template, 1, 3, ":svg:path", 0);
  }
  if (rf & 2) {
    let tmp_1_0;
    const ctx_r0 = ɵɵnextContext();
    ɵɵconditional((tmp_1_0 = ctx_r0.path()) ? 0 : -1, tmp_1_0);
  }
}
function ConnectionComponent_Conditional_1_Conditional_0_ng_container_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵelementContainer(0);
  }
}
function ConnectionComponent_Conditional_1_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵtemplate(0, ConnectionComponent_Conditional_1_Conditional_0_ng_container_0_Template, 1, 0, "ng-container", 1);
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext(2);
    ɵɵproperty("ngTemplateOutlet", ctx)("ngTemplateOutletContext", ctx_r0.getContext());
  }
}
function ConnectionComponent_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, ConnectionComponent_Conditional_1_Conditional_0_Template, 1, 2, "ng-container");
  }
  if (rf & 2) {
    let tmp_1_0;
    const ctx_r0 = ɵɵnextContext();
    ɵɵconditional((tmp_1_0 = ctx_r0.template()) ? 0 : -1, tmp_1_0);
  }
}
var _c8 = ["background", ""];
function BackgroundComponent_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵdomElementStart(0, "pattern", 0);
    ɵɵdomElement(1, "circle");
    ɵɵdomElementEnd();
    ɵɵdomElement(2, "rect", 1);
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext();
    ɵɵattribute("id", ctx_r0.patternId)("x", ctx_r0.x())("y", ctx_r0.y())("width", ctx_r0.scaledGap())("height", ctx_r0.scaledGap());
    ɵɵadvance();
    ɵɵattribute("cx", ctx_r0.patternSize())("cy", ctx_r0.patternSize())("r", ctx_r0.patternSize())("fill", ctx_r0.patternColor());
    ɵɵadvance();
    ɵɵattribute("fill", ctx_r0.patternUrl);
  }
}
function BackgroundComponent_Conditional_1_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵdomElementStart(0, "pattern", 0);
    ɵɵdomElement(1, "image");
    ɵɵdomElementEnd();
    ɵɵdomElement(2, "rect", 1);
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext(2);
    ɵɵattribute("id", ctx_r0.patternId)("x", ctx_r0.imageX())("y", ctx_r0.imageY())("width", ctx_r0.scaledImageWidth())("height", ctx_r0.scaledImageHeight());
    ɵɵadvance();
    ɵɵattribute("href", ctx_r0.bgImageSrc())("width", ctx_r0.scaledImageWidth())("height", ctx_r0.scaledImageHeight());
    ɵɵadvance();
    ɵɵattribute("fill", ctx_r0.patternUrl);
  }
}
function BackgroundComponent_Conditional_1_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵdomElement(0, "image");
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext(2);
    ɵɵattribute("x", ctx_r0.imageX())("y", ctx_r0.imageY())("width", ctx_r0.scaledImageWidth())("height", ctx_r0.scaledImageHeight())("href", ctx_r0.bgImageSrc());
  }
}
function BackgroundComponent_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, BackgroundComponent_Conditional_1_Conditional_0_Template, 3, 9);
    ɵɵconditionalCreate(1, BackgroundComponent_Conditional_1_Conditional_1_Template, 1, 5, ":svg:image");
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext();
    ɵɵconditional(ctx_r0.repeated() ? 0 : -1);
    ɵɵadvance();
    ɵɵconditional(!ctx_r0.repeated() ? 1 : -1);
  }
}
var _c9 = ["flowDefs", ""];
function DefsComponent_For_1_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵdomElement(0, "polyline", 3);
  }
  if (rf & 2) {
    const marker_r1 = ɵɵnextContext().$implicit;
    const ctx_r1 = ɵɵnextContext();
    ɵɵstyleProp("stroke", marker_r1.value.color ?? ctx_r1.defaultColor)("stroke-width", marker_r1.value.strokeWidth ?? 2)("fill", marker_r1.value.color ?? ctx_r1.defaultColor);
  }
}
function DefsComponent_For_1_Conditional_2_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵdomElement(0, "polyline", 4);
  }
  if (rf & 2) {
    const marker_r1 = ɵɵnextContext().$implicit;
    const ctx_r1 = ɵɵnextContext();
    ɵɵstyleProp("stroke", marker_r1.value.color ?? ctx_r1.defaultColor)("stroke-width", marker_r1.value.strokeWidth ?? 2);
  }
}
function DefsComponent_For_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵdomElementStart(0, "marker", 0);
    ɵɵconditionalCreate(1, DefsComponent_For_1_Conditional_1_Template, 1, 6, ":svg:polyline", 1);
    ɵɵconditionalCreate(2, DefsComponent_For_1_Conditional_2_Template, 1, 4, ":svg:polyline", 2);
    ɵɵdomElementEnd();
  }
  if (rf & 2) {
    const marker_r1 = ctx.$implicit;
    ɵɵattribute("id", marker_r1.key)("markerWidth", marker_r1.value.width ?? 16.5)("markerHeight", marker_r1.value.height ?? 16.5)("orient", marker_r1.value.orient ?? "auto-start-reverse")("markerUnits", marker_r1.value.markerUnits ?? "userSpaceOnUse");
    ɵɵadvance();
    ɵɵconditional(marker_r1.value.type === "arrow-closed" || !marker_r1.value.type ? 1 : -1);
    ɵɵadvance();
    ɵɵconditional(marker_r1.value.type === "arrow" ? 2 : -1);
  }
}
var _c10 = ["previewFlow", ""];
var _c11 = ["alignmentHelper", ""];
function AlignmentHelperComponent_Conditional_0_Conditional_0_For_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵdomElement(0, "line");
  }
  if (rf & 2) {
    const intersection_r1 = ctx.$implicit;
    const ctx_r1 = ɵɵnextContext(3);
    ɵɵattribute("stroke", ctx_r1.lineColor())("stroke-dasharray", intersection_r1.isCenter ? 4 : null)("x1", intersection_r1.x)("y1", intersection_r1.y)("x2", intersection_r1.x2)("y2", intersection_r1.y2);
  }
}
function AlignmentHelperComponent_Conditional_0_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵrepeaterCreate(0, AlignmentHelperComponent_Conditional_0_Conditional_0_For_1_Template, 1, 6, ":svg:line", null, ɵɵrepeaterTrackByIndex);
  }
  if (rf & 2) {
    ɵɵrepeater(ctx.lines);
  }
}
function AlignmentHelperComponent_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, AlignmentHelperComponent_Conditional_0_Conditional_0_Template, 2, 0);
  }
  if (rf & 2) {
    let tmp_1_0;
    const ctx_r1 = ɵɵnextContext();
    ɵɵconditional((tmp_1_0 = ctx_r1.intersections()) ? 0 : -1, tmp_1_0);
  }
}
function VflowComponent_Conditional_5_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "g", 8);
  }
}
function VflowComponent_Conditional_5_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "g", 9);
  }
  if (rf & 2) {
    const alignmentHelper_r1 = ɵɵnextContext();
    ɵɵproperty("tolerance", alignmentHelper_r1.tolerance)("lineColor", alignmentHelper_r1.lineColor);
  }
}
function VflowComponent_Conditional_5_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵconditionalCreate(0, VflowComponent_Conditional_5_Conditional_0_Template, 1, 0, ":svg:g", 8)(1, VflowComponent_Conditional_5_Conditional_1_Template, 1, 2, ":svg:g", 9);
  }
  if (rf & 2) {
    ɵɵconditional(ctx === true ? 0 : 1);
  }
}
function VflowComponent_Conditional_7_For_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "g", 10);
  }
  if (rf & 2) {
    let tmp_13_0;
    const model_r2 = ctx.$implicit;
    const ctx_r2 = ɵɵnextContext(2);
    ɵɵproperty("model", model_r2)("groupNodeTemplate", (tmp_13_0 = ctx_r2.groupNodeTemplateDirective()) == null ? null : tmp_13_0.templateRef);
    ɵɵattribute("transform", model_r2.pointTransform());
  }
}
function VflowComponent_Conditional_7_For_3_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "g", 11);
  }
  if (rf & 2) {
    let tmp_13_0;
    let tmp_14_0;
    const model_r4 = ctx.$implicit;
    const ctx_r2 = ɵɵnextContext(2);
    ɵɵproperty("model", model_r4)("edgeTemplate", (tmp_13_0 = ctx_r2.edgeTemplateDirective()) == null ? null : tmp_13_0.templateRef)("edgeLabelHtmlTemplate", (tmp_14_0 = ctx_r2.edgeLabelHtmlDirective()) == null ? null : tmp_14_0.templateRef);
  }
}
function VflowComponent_Conditional_7_For_5_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "g", 12);
  }
  if (rf & 2) {
    let tmp_13_0;
    let tmp_14_0;
    const model_r5 = ctx.$implicit;
    const ctx_r2 = ɵɵnextContext(2);
    ɵɵproperty("model", model_r5)("nodeTemplate", (tmp_13_0 = ctx_r2.nodeTemplateDirective()) == null ? null : tmp_13_0.templateRef)("nodeSvgTemplate", (tmp_14_0 = ctx_r2.nodeSvgTemplateDirective()) == null ? null : tmp_14_0.templateRef);
    ɵɵattribute("transform", model_r5.pointTransform());
  }
}
function VflowComponent_Conditional_7_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵrepeaterCreate(0, VflowComponent_Conditional_7_For_1_Template, 1, 3, ":svg:g", 10, ɵɵcomponentInstance().trackNodes, true);
    ɵɵrepeaterCreate(2, VflowComponent_Conditional_7_For_3_Template, 1, 3, ":svg:g", 11, ɵɵcomponentInstance().trackEdges, true);
    ɵɵrepeaterCreate(4, VflowComponent_Conditional_7_For_5_Template, 1, 4, ":svg:g", 12, ɵɵcomponentInstance().trackNodes, true);
  }
  if (rf & 2) {
    const ctx_r2 = ɵɵnextContext();
    ɵɵrepeater(ctx_r2.groups());
    ɵɵadvance(2);
    ɵɵrepeater(ctx_r2.edgeModels());
    ɵɵadvance(2);
    ɵɵrepeater(ctx_r2.nonGroups());
  }
}
function VflowComponent_Conditional_8_For_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "g", 11);
  }
  if (rf & 2) {
    let tmp_13_0;
    let tmp_14_0;
    const model_r6 = ctx.$implicit;
    const ctx_r2 = ɵɵnextContext(2);
    ɵɵproperty("model", model_r6)("edgeTemplate", (tmp_13_0 = ctx_r2.edgeTemplateDirective()) == null ? null : tmp_13_0.templateRef)("edgeLabelHtmlTemplate", (tmp_14_0 = ctx_r2.edgeLabelHtmlDirective()) == null ? null : tmp_14_0.templateRef);
  }
}
function VflowComponent_Conditional_8_For_3_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "g", 13);
  }
  if (rf & 2) {
    let tmp_13_0;
    let tmp_14_0;
    let tmp_15_0;
    const model_r7 = ctx.$implicit;
    const ctx_r2 = ɵɵnextContext(2);
    ɵɵproperty("model", model_r7)("nodeTemplate", (tmp_13_0 = ctx_r2.nodeTemplateDirective()) == null ? null : tmp_13_0.templateRef)("nodeSvgTemplate", (tmp_14_0 = ctx_r2.nodeSvgTemplateDirective()) == null ? null : tmp_14_0.templateRef)("groupNodeTemplate", (tmp_15_0 = ctx_r2.groupNodeTemplateDirective()) == null ? null : tmp_15_0.templateRef);
    ɵɵattribute("transform", model_r7.pointTransform());
  }
}
function VflowComponent_Conditional_8_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵrepeaterCreate(0, VflowComponent_Conditional_8_For_1_Template, 1, 3, ":svg:g", 11, ɵɵcomponentInstance().trackEdges, true);
    ɵɵrepeaterCreate(2, VflowComponent_Conditional_8_For_3_Template, 1, 5, ":svg:g", 13, ɵɵcomponentInstance().trackNodes, true);
  }
  if (rf & 2) {
    const ctx_r2 = ɵɵnextContext();
    ɵɵrepeater(ctx_r2.edgeModels());
    ɵɵadvance(2);
    ɵɵrepeater(ctx_r2.nodeModels());
  }
}
function VflowComponent_Conditional_9_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelementContainer(0, 6);
  }
  if (rf & 2) {
    ɵɵproperty("ngTemplateOutlet", ctx.template());
  }
}
function VflowComponent_Conditional_10_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵelement(0, "canvas", 7);
  }
  if (rf & 2) {
    const ctx_r2 = ɵɵnextContext();
    ɵɵproperty("width", ctx_r2.flowWidth())("height", ctx_r2.flowHeight());
  }
}
var _c12 = ["minimap"];
function MiniMapComponent_ng_template_0_For_6_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelementStart(0, "foreignObject");
    ɵɵnamespaceHTML();
    ɵɵelementStart(1, "default-node", 4);
    ɵɵelement(2, "div", 5);
    ɵɵelementEnd()();
  }
  if (rf & 2) {
    const model_r3 = ɵɵnextContext().$implicit;
    ɵɵattribute("transform", model_r3.pointTransform())("width", model_r3.size().width)("height", model_r3.size().height);
    ɵɵadvance();
    ɵɵstyleProp("width", model_r3.size().width, "px")("height", model_r3.size().height, "px")("max-width", model_r3.size().width, "px")("max-height", model_r3.size().height, "px");
    ɵɵproperty("selected", model_r3.selected());
    ɵɵadvance();
    ɵɵproperty("outerHTML", model_r3.text(), ɵɵsanitizeHtml);
  }
}
function MiniMapComponent_ng_template_0_For_6_Conditional_2_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelement(0, "rect", 6);
  }
  if (rf & 2) {
    const model_r3 = ɵɵnextContext().$implicit;
    ɵɵstyleProp("stroke", model_r3.color())("fill", model_r3.color());
    ɵɵclassProp("default-group-node_selected", model_r3.selected());
    ɵɵattribute("transform", model_r3.pointTransform())("width", model_r3.size().width)("height", model_r3.size().height);
  }
}
function MiniMapComponent_ng_template_0_For_6_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵnamespaceSVG();
    ɵɵelementContainerStart(0);
    ɵɵconditionalCreate(1, MiniMapComponent_ng_template_0_For_6_Conditional_1_Template, 3, 13, ":svg:foreignObject");
    ɵɵconditionalCreate(2, MiniMapComponent_ng_template_0_For_6_Conditional_2_Template, 1, 9, ":svg:rect", 3);
    ɵɵelementContainerEnd();
  }
  if (rf & 2) {
    const model_r3 = ctx.$implicit;
    ɵɵadvance();
    ɵɵconditional(model_r3.rawNode.type === "default" || model_r3.rawNode.type === "html-template" || model_r3.isComponentType ? 1 : -1);
    ɵɵadvance();
    ɵɵconditional(model_r3.rawNode.type === "default-group" || model_r3.rawNode.type === "template-group" ? 2 : -1);
  }
}
function MiniMapComponent_ng_template_0_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = ɵɵgetCurrentView();
    ɵɵnamespaceSVG();
    ɵɵelement(0, "rect", 1);
    ɵɵelementStart(1, "svg", 2);
    ɵɵlistener("mouseover", function MiniMapComponent_ng_template_0_Template_svg_mouseover_1_listener() {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.hovered.set(true));
    })("mouseleave", function MiniMapComponent_ng_template_0_Template_svg_mouseleave_1_listener() {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.hovered.set(false));
    });
    ɵɵelement(2, "rect");
    ɵɵelementStart(3, "g");
    ɵɵelement(4, "rect");
    ɵɵrepeaterCreate(5, MiniMapComponent_ng_template_0_For_6_Template, 3, 2, ":svg:ng-container", null, ɵɵcomponentInstance().trackNodes, true);
    ɵɵelementEnd()();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵattribute("x", ctx_r1.minimapPoint().x)("y", ctx_r1.minimapPoint().y)("width", ctx_r1.minimapWidth())("height", ctx_r1.minimapHeight())("stroke", ctx_r1.strokeColor());
    ɵɵadvance();
    ɵɵattribute("x", ctx_r1.minimapPoint().x)("y", ctx_r1.minimapPoint().y)("width", ctx_r1.minimapWidth())("height", ctx_r1.minimapHeight());
    ɵɵadvance();
    ɵɵattribute("width", ctx_r1.minimapWidth())("height", ctx_r1.minimapHeight())("fill", ctx_r1.maskColor());
    ɵɵadvance();
    ɵɵattribute("transform", ctx_r1.minimapTransform());
    ɵɵadvance();
    ɵɵattribute("fill", ctx_r1.viewportColor())("transform", ctx_r1.viewportTransform())("width", ctx_r1.minimapWidth())("height", ctx_r1.minimapHeight());
    ɵɵadvance();
    ɵɵrepeater(ctx_r1.entitiesService.nodes());
  }
}
var _c13 = ["toolbar"];
function NodeToolbarComponent_ng_template_0_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵelementStart(0, "div", 1);
    ɵɵprojection(1);
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext();
    ɵɵproperty("model", ctx_r0.model);
  }
}
var _c14 = ["customTemplateEdge", ""];
var getOverlappingArea = (rectA, rectB) => {
  const xOverlap = Math.max(0, Math.min(rectA.x + rectA.width, rectB.x + rectB.width) - Math.max(rectA.x, rectB.x));
  const yOverlap = Math.max(0, Math.min(rectA.y + rectA.height, rectB.y + rectB.height) - Math.max(rectA.y, rectB.y));
  return Math.ceil(xOverlap * yOverlap);
};
function getNodesBounds(nodes) {
  if (nodes.length === 0) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };
  }
  let box = {
    x: Infinity,
    y: Infinity,
    x2: -Infinity,
    y2: -Infinity
  };
  nodes.forEach((node) => {
    const nodeBox = nodeToBox(node);
    box = getBoundsOfBoxes(box, nodeBox);
  });
  return boxToRect(box);
}
function getIntesectingNodes(nodeId, nodes, options) {
  const node = nodes.find((n) => n.rawNode.id === nodeId);
  if (!node) return [];
  const nodeRect = nodeToRect(node);
  return nodes.filter((currentNode) => {
    if (currentNode.rawNode.id === nodeId) return false;
    const overlappingArea = getOverlappingArea(nodeToRect(currentNode), nodeRect);
    if (options?.partially) {
      return overlappingArea > 0;
    }
    return overlappingArea >= nodeRect.width * nodeRect.height;
  });
}
function nodeToBox(node) {
  return {
    x: node.point().x,
    y: node.point().y,
    x2: node.point().x + node.size().width,
    y2: node.point().y + node.size().height
  };
}
function nodeToRect(node) {
  return {
    x: node.globalPoint().x,
    y: node.globalPoint().y,
    width: node.width(),
    height: node.height()
  };
}
function boxToRect({
  x,
  y,
  x2,
  y2
}) {
  return {
    x,
    y,
    width: x2 - x,
    height: y2 - y
  };
}
function getBoundsOfBoxes(box1, box2) {
  return {
    x: Math.min(box1.x, box2.x),
    y: Math.min(box1.y, box2.y),
    x2: Math.max(box1.x2, box2.x2),
    y2: Math.max(box1.y2, box2.y2)
  };
}
var ConnectionModel = class {
  constructor(settings) {
    this.settings = settings;
    this.curve = settings.curve ?? "bezier";
    this.type = settings.type ?? "default";
    this.mode = settings.mode ?? "strict";
    const validatorsToRun = this.getValidators(settings);
    this.validator = (connection) => validatorsToRun.every((v) => v(connection));
  }
  getValidators(settings) {
    const validators = [];
    validators.push(notSelfValidator);
    if (this.mode === "loose") {
      validators.push(hasSourceAndTargetHandleValidator);
    }
    if (settings.validator) {
      validators.push(settings.validator);
    }
    return validators;
  }
};
var notSelfValidator = (connection) => {
  return connection.source !== connection.target;
};
var hasSourceAndTargetHandleValidator = (connection) => {
  return connection.sourceHandle !== void 0 && connection.targetHandle !== void 0;
};
function hashCode(str) {
  return str.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);
}
var FlowEntitiesService = class _FlowEntitiesService {
  constructor() {
    this.nodes = signal([], {
      // empty arrays considered equal, other arrays may not be equal
      equal: (a, b) => !a.length && !b.length ? true : a === b
    });
    this.rawNodes = computed(() => this.nodes().map((n) => n.rawNode));
    this.edges = signal([], {
      // empty arrays considered equal, other arrays may not be equal
      equal: (a, b) => !a.length && !b.length ? true : a === b
    });
    this.rawEdges = computed(() => this.edges().map((e) => e.edge));
    this.validEdges = computed(() => {
      const nodes = this.nodes();
      return this.edges().filter((e) => nodes.includes(e.source()) && nodes.includes(e.target()));
    });
    this.connection = signal(new ConnectionModel({}));
    this.markers = computed(() => {
      const markersMap = /* @__PURE__ */ new Map();
      this.validEdges().forEach((e) => {
        if (e.edge.markers?.start) {
          const hash = hashCode(JSON.stringify(e.edge.markers.start));
          markersMap.set(hash, e.edge.markers.start);
        }
        if (e.edge.markers?.end) {
          const hash = hashCode(JSON.stringify(e.edge.markers.end));
          markersMap.set(hash, e.edge.markers.end);
        }
      });
      const connectionMarker = this.connection().settings.marker;
      if (connectionMarker) {
        const hash = hashCode(JSON.stringify(connectionMarker));
        markersMap.set(hash, connectionMarker);
      }
      return markersMap;
    });
    this.entities = computed(() => [...this.nodes(), ...this.edges()]);
    this.minimap = signal(null);
  }
  getNode(id3) {
    return this.nodes().find(({
      rawNode
    }) => rawNode.id === id3);
  }
  getDetachedEdges() {
    return this.edges().filter((e) => e.detached());
  }
  static {
    this.ɵfac = function FlowEntitiesService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _FlowEntitiesService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _FlowEntitiesService,
      factory: _FlowEntitiesService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(FlowEntitiesService, [{
    type: Injectable
  }], null, null);
})();
function getViewportForBounds(bounds, width, height, minZoom, maxZoom, padding) {
  const xZoom = width / (bounds.width * (1 + padding));
  const yZoom = height / (bounds.height * (1 + padding));
  const zoom = Math.min(xZoom, yZoom);
  const clampedZoom = clamp(zoom, minZoom, maxZoom);
  const boundsCenterX = bounds.x + bounds.width / 2;
  const boundsCenterY = bounds.y + bounds.height / 2;
  const x = width / 2 - boundsCenterX * clampedZoom;
  const y = height / 2 - boundsCenterY * clampedZoom;
  return {
    x,
    y,
    zoom: clampedZoom
  };
}
function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}
function getViewportBounds(viewport, flowWidth, flowHeight) {
  const zoom = viewport.zoom;
  return {
    x: -viewport.x / zoom,
    y: -viewport.y / zoom,
    width: flowWidth / zoom,
    height: flowHeight / zoom
  };
}
function isRectInViewport(rect, viewport, flowWidth, flowHeight) {
  const viewportBounds = getViewportBounds(viewport, flowWidth, flowHeight);
  const isNotIntersecting = rect.x + rect.width < viewportBounds.x || // Rect is completely to the left
  rect.x > viewportBounds.x + viewportBounds.width || // Rect is completely to the right
  rect.y + rect.height < viewportBounds.y || // Rect is completely above
  rect.y > viewportBounds.y + viewportBounds.height;
  return !isNotIntersecting;
}
var DEFAULT_OPTIMIZATION = {
  detachedGroupsLayer: false,
  virtualization: false,
  virtualizationZoomThreshold: 0.5,
  lazyLoadTrigger: "immediate"
};
var FlowSettingsService = class _FlowSettingsService {
  constructor() {
    this.entitiesSelectable = signal(true);
    this.elevateNodesOnSelect = signal(true);
    this.elevateEdgesOnSelect = signal(true);
    this.view = signal([400, 400]);
    this.computedFlowWidth = signal(0);
    this.computedFlowHeight = signal(0);
    this.minZoom = signal(0.5);
    this.maxZoom = signal(3);
    this.background = signal({
      type: "solid",
      color: "#fff"
    });
    this.snapGrid = signal([1, 1]);
    this.optimization = signal(DEFAULT_OPTIMIZATION);
  }
  static {
    this.ɵfac = function FlowSettingsService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _FlowSettingsService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _FlowSettingsService,
      factory: _FlowSettingsService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(FlowSettingsService, [{
    type: Injectable
  }], null, null);
})();
var ViewportService = class _ViewportService {
  constructor() {
    this.entitiesService = inject(FlowEntitiesService);
    this.flowSettingsService = inject(FlowSettingsService);
    this.writableViewport = signal({
      changeType: "initial",
      state: _ViewportService.getDefaultViewport(),
      duration: 0
    });
    this.readableViewport = signal(_ViewportService.getDefaultViewport());
    this.viewportChangeEnd$ = new Subject();
  }
  /**
   * The default value used by d3, just copy it here
   *
   * @returns default viewport value
   */
  static getDefaultViewport() {
    return {
      zoom: 1,
      x: 0,
      y: 0
    };
  }
  // TODO: add writableViewportWithConstraints (to apply min zoom/max zoom values)
  fitView(options = {
    padding: 0.1,
    duration: 0,
    nodes: []
  }) {
    const nodes = this.getBoundsNodes(options.nodes ?? []);
    const state = getViewportForBounds(getNodesBounds(nodes), this.flowSettingsService.computedFlowWidth(), this.flowSettingsService.computedFlowHeight(), this.flowSettingsService.minZoom(), this.flowSettingsService.maxZoom(), options.padding ?? 0.1);
    const duration = options.duration ?? 0;
    this.writableViewport.set({
      changeType: "absolute",
      state,
      duration
    });
  }
  triggerViewportChangeEvent(type) {
    if (type === "end") {
      this.viewportChangeEnd$.next();
    }
  }
  getBoundsNodes(nodeIds) {
    return !nodeIds?.length ? (
      // If nodes option not passed or the list is empty, then get fit the whole view
      this.entitiesService.nodes()
    ) : (
      // Otherwise fit to specific nodes
      nodeIds.map((nodeId) => this.entitiesService.nodes().find(({
        rawNode
      }) => rawNode.id === nodeId)).filter((node) => !!node)
    );
  }
  static {
    this.ɵfac = function ViewportService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _ViewportService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _ViewportService,
      factory: _ViewportService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ViewportService, [{
    type: Injectable
  }], null, null);
})();
function isDefined(data) {
  return data !== void 0;
}
var RootSvgReferenceDirective = class _RootSvgReferenceDirective {
  constructor() {
    this.element = inject(ElementRef).nativeElement;
  }
  static {
    this.ɵfac = function RootSvgReferenceDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _RootSvgReferenceDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _RootSvgReferenceDirective,
      selectors: [["svg", "rootSvgRef", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(RootSvgReferenceDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "svg[rootSvgRef]"
    }]
  }], null, null);
})();
function getOS() {
  const userAgent = window.navigator.userAgent.toLowerCase();
  const macosPlatforms = /(macintosh|macintel|macppc|mac68k|macos)/i;
  const windowsPlatforms = /(win32|win64|windows|wince)/i;
  const iosPlatforms = /(iphone|ipad|ipod)/i;
  let os = null;
  if (macosPlatforms.test(userAgent)) {
    os = "macos";
  } else if (iosPlatforms.test(userAgent)) {
    os = "ios";
  } else if (windowsPlatforms.test(userAgent)) {
    os = "windows";
  } else if (/android/.test(userAgent)) {
    os = "android";
  } else if (!os && /linux/.test(userAgent)) {
    os = "linux";
  }
  return os;
}
var KeyboardService = class _KeyboardService {
  constructor() {
    this.actions = signal({
      multiSelection: [getOS() === "macos" ? "MetaLeft" : "ControlLeft", getOS() === "macos" ? "MetaRight" : "ControlRight"]
    });
    this.actionsActive = {
      multiSelection: false
    };
    toObservable(this.actions).pipe(switchMap(() => merge(fromEvent(document, "keydown").pipe(tap((event) => {
      for (const action in this.actions()) {
        const keyCodes = this.actions()[action] ?? [];
        if (keyCodes.includes(event.code)) {
          this.actionsActive[action] = true;
        }
      }
    })), fromEvent(document, "keyup").pipe(tap((event) => {
      for (const action in this.actions()) {
        const keyCodes = this.actions()[action] ?? [];
        if (keyCodes.includes(event.code)) {
          this.actionsActive[action] = false;
        }
      }
    })))), takeUntilDestroyed()).subscribe();
  }
  setShortcuts(newActions) {
    this.actions.update((actions) => __spreadValues(__spreadValues({}, actions), newActions));
  }
  isActiveAction(action) {
    return this.actionsActive[action];
  }
  static {
    this.ɵfac = function KeyboardService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _KeyboardService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _KeyboardService,
      factory: _KeyboardService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(KeyboardService, [{
    type: Injectable
  }], () => [], null);
})();
var SelectionService = class _SelectionService {
  constructor() {
    this.flowEntitiesService = inject(FlowEntitiesService);
    this.keyboardService = inject(KeyboardService);
    this.viewport$ = new Subject();
    this.resetSelection = this.viewport$.pipe(tap(({
      start: start2,
      end,
      target
    }) => {
      if (start2 && end && target) {
        const delta = _SelectionService.delta;
        const diffX = Math.abs(end.x - start2.x);
        const diffY = Math.abs(end.y - start2.y);
        const isClick = diffX < delta && diffY < delta;
        const isNotSelectable = !target.closest(".selectable");
        if (isClick && isNotSelectable) {
          this.select(null);
        }
      }
    }), takeUntilDestroyed()).subscribe();
  }
  static {
    this.delta = 6;
  }
  setViewport(viewport) {
    this.viewport$.next(viewport);
  }
  select(entity) {
    if (entity?.selected()) {
      return;
    }
    if (!this.keyboardService.isActiveAction("multiSelection")) {
      this.flowEntitiesService.entities().forEach((n) => n.selected.set(false));
    }
    if (entity) {
      entity.selected.set(true);
    }
  }
  static {
    this.ɵfac = function SelectionService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _SelectionService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _SelectionService,
      factory: _SelectionService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(SelectionService, [{
    type: Injectable
  }], null, null);
})();
var MapContextDirective = class _MapContextDirective {
  constructor() {
    this.rootSvg = inject(RootSvgReferenceDirective).element;
    this.host = inject(ElementRef).nativeElement;
    this.selectionService = inject(SelectionService);
    this.viewportService = inject(ViewportService);
    this.flowSettingsService = inject(FlowSettingsService);
    this.zone = inject(NgZone);
    this.rootSvgSelection = select_default2(this.rootSvg);
    this.transform = signal("");
    this.viewportForSelection = {};
    this.manualViewportChangeEffect = effect(() => {
      const viewport = this.viewportService.writableViewport();
      const state = viewport.state;
      if (viewport.changeType === "initial") {
        return;
      }
      if (isDefined(state.zoom) && !isDefined(state.x) && !isDefined(state.y)) {
        this.rootSvgSelection.transition().duration(viewport.duration).call(this.zoomBehavior.scaleTo, state.zoom);
        return;
      }
      if (isDefined(state.x) && isDefined(state.y) && !isDefined(state.zoom)) {
        const zoom = untracked(this.viewportService.readableViewport).zoom;
        this.rootSvgSelection.transition().duration(viewport.duration).call(this.zoomBehavior.transform, identity2.translate(state.x, state.y).scale(zoom));
        return;
      }
      if (isDefined(state.x) && isDefined(state.y) && isDefined(state.zoom)) {
        this.rootSvgSelection.transition().duration(viewport.duration).call(this.zoomBehavior.transform, identity2.translate(state.x, state.y).scale(state.zoom));
        return;
      }
    }, {
      allowSignalWrites: true
    });
    this.handleZoom = ({
      transform: transform2
    }) => {
      this.viewportService.readableViewport.set(mapTransformToViewportState(transform2));
      this.transform.set(transform2.toString());
    };
    this.handleZoomStart = ({
      transform: transform2
    }) => {
      this.viewportForSelection = {
        start: mapTransformToViewportState(transform2)
      };
    };
    this.handleZoomEnd = ({
      transform: transform2,
      sourceEvent
    }) => {
      this.zone.run(() => {
        this.viewportForSelection = __spreadProps(__spreadValues({}, this.viewportForSelection), {
          end: mapTransformToViewportState(transform2),
          target: evTarget(sourceEvent)
        });
        this.viewportService.triggerViewportChangeEvent("end");
        this.selectionService.setViewport(this.viewportForSelection);
      });
    };
    this.filterCondition = (event) => {
      if (event.type === "mousedown" || event.type === "touchstart") {
        return event.target.closest(".vflow-node") === null;
      }
      return true;
    };
  }
  ngOnInit() {
    this.zone.runOutsideAngular(() => {
      this.zoomBehavior = zoom_default2().scaleExtent([this.flowSettingsService.minZoom(), this.flowSettingsService.maxZoom()]).filter(this.filterCondition).on("start", this.handleZoomStart).on("zoom", this.handleZoom).on("end", this.handleZoomEnd);
      this.rootSvgSelection.call(this.zoomBehavior).on("dblclick.zoom", null);
    });
  }
  static {
    this.ɵfac = function MapContextDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _MapContextDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _MapContextDirective,
      selectors: [["g", "mapContext", ""]],
      hostVars: 1,
      hostBindings: function MapContextDirective_HostBindings(rf, ctx) {
        if (rf & 2) {
          ɵɵattribute("transform", ctx.transform());
        }
      }
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(MapContextDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "g[mapContext]",
      host: {
        "[attr.transform]": "transform()"
      }
    }]
  }], null, null);
})();
var mapTransformToViewportState = (transform2) => ({
  zoom: transform2.k,
  x: transform2.x,
  y: transform2.y
});
var evTarget = (anyEvent) => {
  if (anyEvent instanceof Event && anyEvent.target instanceof Element) {
    return anyEvent.target;
  }
  return void 0;
};
var round = (num) => Math.round(num * 100) / 100;
function align(num, constant) {
  return Math.ceil(num / constant) * constant;
}
var FlowStatusService = class _FlowStatusService {
  constructor() {
    this.status = signal({
      state: "idle",
      payload: null
    });
  }
  setIdleStatus() {
    this.status.set({
      state: "idle",
      payload: null
    });
  }
  setConnectionStartStatus(source, sourceHandle) {
    this.status.set({
      state: "connection-start",
      payload: {
        source,
        sourceHandle
      }
    });
  }
  setReconnectionStartStatus(source, sourceHandle, oldEdge) {
    this.status.set({
      state: "reconnection-start",
      payload: {
        source,
        sourceHandle,
        oldEdge
      }
    });
  }
  setConnectionValidationStatus(valid, source, target, sourceHandle, targetHandle) {
    this.status.set({
      state: "connection-validation",
      payload: {
        source,
        target,
        sourceHandle,
        targetHandle,
        valid
      }
    });
  }
  setReconnectionValidationStatus(valid, source, target, sourceHandle, targetHandle, oldEdge) {
    this.status.set({
      state: "reconnection-validation",
      payload: {
        source,
        target,
        sourceHandle,
        targetHandle,
        valid,
        oldEdge
      }
    });
  }
  setConnectionEndStatus(source, target, sourceHandle, targetHandle) {
    this.status.set({
      state: "connection-end",
      payload: {
        source,
        target,
        sourceHandle,
        targetHandle
      }
    });
  }
  setReconnectionEndStatus(source, target, sourceHandle, targetHandle, oldEdge) {
    this.status.set({
      state: "reconnection-end",
      payload: {
        source,
        target,
        sourceHandle,
        targetHandle,
        oldEdge
      }
    });
  }
  setNodeDragStartStatus(node) {
    this.status.set({
      state: "node-drag-start",
      payload: {
        node
      }
    });
  }
  setNodeDragEndStatus(node) {
    this.status.set({
      state: "node-drag-end",
      payload: {
        node
      }
    });
  }
  static {
    this.ɵfac = function FlowStatusService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _FlowStatusService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _FlowStatusService,
      factory: _FlowStatusService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(FlowStatusService, [{
    type: Injectable
  }], null, null);
})();
function isNodeDragStartStatus(params) {
  return params.state === "node-drag-start";
}
function isNodeDragEndStatus(params) {
  return params.state === "node-drag-end";
}
var DraggableService = class _DraggableService {
  constructor() {
    this.entitiesService = inject(FlowEntitiesService);
    this.settingsService = inject(FlowSettingsService);
    this.flowStatusService = inject(FlowStatusService);
  }
  /**
   * Enable draggable behavior for element.
   *
   * @param element target element for toggling draggable
   * @param model model with data for this element
   */
  enable(element, model) {
    select_default2(element).call(this.getDragBehavior(model));
  }
  /**
   * Disable draggable behavior for element.
   *
   * @param element target element for toggling draggable
   * @param model model with data for this element
   */
  disable(element) {
    select_default2(element).call(drag_default().on("drag", null));
  }
  /**
   * TODO: not shure if this work, need to check
   *
   * @param element
   */
  destroy(element) {
    select_default2(element).on(".drag", null);
  }
  /**
   * Node drag behavior. Updated node's coordinate according to dragging
   *
   * @param model
   * @returns
   */
  getDragBehavior(model) {
    let dragNodes = [];
    let initialPositions = [];
    const filterCondition = (event) => {
      if (model.dragHandlesCount()) {
        return !!event.target.closest(".vflow-drag-handle");
      }
      return true;
    };
    return drag_default().filter(filterCondition).on("start", (event) => {
      dragNodes = this.getDragNodes(model);
      this.flowStatusService.setNodeDragStartStatus(model);
      initialPositions = dragNodes.map((node) => ({
        x: node.point().x - event.x,
        y: node.point().y - event.y
      }));
    }).on("drag", (event) => {
      dragNodes.forEach((model2, index) => {
        const point = {
          x: round(event.x + initialPositions[index].x),
          y: round(event.y + initialPositions[index].y)
        };
        this.moveNode(model2, point);
      });
    }).on("end", () => {
      this.flowStatusService.setNodeDragEndStatus(model);
    });
  }
  getDragNodes(model) {
    return model.selected() ? this.entitiesService.nodes().filter((node) => node.selected() && node.draggable()) : (
      // we only can move current node if it's not selected
      [model]
    );
  }
  /**
   * @todo make it unit testable
   */
  moveNode(model, point) {
    point = this.alignToGrid(point);
    const parent = model.parent();
    if (parent) {
      point.x = Math.min(parent.width() - model.width(), point.x);
      point.x = Math.max(0, point.x);
      point.y = Math.min(parent.height() - model.height(), point.y);
      point.y = Math.max(0, point.y);
    }
    model.setPoint(point);
  }
  /**
   * @todo make it unit testable
   */
  alignToGrid(point) {
    const [snapX, snapY] = this.settingsService.snapGrid();
    if (snapX > 1) {
      point.x = align(point.x, snapX);
    }
    if (snapY > 1) {
      point.y = align(point.y, snapY);
    }
    return point;
  }
  static {
    this.ɵfac = function DraggableService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _DraggableService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _DraggableService,
      factory: _DraggableService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(DraggableService, [{
    type: Injectable
  }], null, null);
})();
var EdgeTemplateDirective = class _EdgeTemplateDirective {
  constructor() {
    this.templateRef = inject(TemplateRef);
  }
  static ngTemplateContextGuard(dir, ctx) {
    return true;
  }
  static {
    this.ɵfac = function EdgeTemplateDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _EdgeTemplateDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _EdgeTemplateDirective,
      selectors: [["ng-template", "edge", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(EdgeTemplateDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "ng-template[edge]"
    }]
  }], null, null);
})();
var ConnectionTemplateDirective = class _ConnectionTemplateDirective {
  constructor() {
    this.templateRef = inject(TemplateRef);
  }
  static ngTemplateContextGuard(dir, ctx) {
    return true;
  }
  static {
    this.ɵfac = function ConnectionTemplateDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _ConnectionTemplateDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _ConnectionTemplateDirective,
      selectors: [["ng-template", "connection", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ConnectionTemplateDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "ng-template[connection]"
    }]
  }], null, null);
})();
var EdgeLabelHtmlTemplateDirective = class _EdgeLabelHtmlTemplateDirective {
  constructor() {
    this.templateRef = inject(TemplateRef);
  }
  static ngTemplateContextGuard(dir, ctx) {
    return true;
  }
  static {
    this.ɵfac = function EdgeLabelHtmlTemplateDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _EdgeLabelHtmlTemplateDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _EdgeLabelHtmlTemplateDirective,
      selectors: [["ng-template", "edgeLabelHtml", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(EdgeLabelHtmlTemplateDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "ng-template[edgeLabelHtml]"
    }]
  }], null, null);
})();
var NodeHtmlTemplateDirective = class _NodeHtmlTemplateDirective {
  constructor() {
    this.templateRef = inject(TemplateRef);
  }
  static ngTemplateContextGuard(dir, ctx) {
    return true;
  }
  static {
    this.ɵfac = function NodeHtmlTemplateDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _NodeHtmlTemplateDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _NodeHtmlTemplateDirective,
      selectors: [["ng-template", "nodeHtml", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(NodeHtmlTemplateDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "ng-template[nodeHtml]"
    }]
  }], null, null);
})();
var NodeSvgTemplateDirective = class _NodeSvgTemplateDirective {
  constructor() {
    this.templateRef = inject(TemplateRef);
  }
  static ngTemplateContextGuard(dir, ctx) {
    return true;
  }
  static {
    this.ɵfac = function NodeSvgTemplateDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _NodeSvgTemplateDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _NodeSvgTemplateDirective,
      selectors: [["ng-template", "nodeSvg", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(NodeSvgTemplateDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "ng-template[nodeSvg]"
    }]
  }], null, null);
})();
var GroupNodeTemplateDirective = class _GroupNodeTemplateDirective {
  constructor() {
    this.templateRef = inject(TemplateRef);
  }
  static ngTemplateContextGuard(dir, ctx) {
    return true;
  }
  static {
    this.ɵfac = function GroupNodeTemplateDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _GroupNodeTemplateDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _GroupNodeTemplateDirective,
      selectors: [["ng-template", "groupNode", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(GroupNodeTemplateDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "ng-template[groupNode]"
    }]
  }], null, null);
})();
var HandleTemplateDirective = class _HandleTemplateDirective {
  constructor() {
    this.templateRef = inject(TemplateRef);
  }
  static {
    this.ɵfac = function HandleTemplateDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _HandleTemplateDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _HandleTemplateDirective,
      selectors: [["ng-template", "handle", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(HandleTemplateDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "ng-template[handle]"
    }]
  }], null, null);
})();
function addNodesToEdges(nodes, edges) {
  const nodesById = nodes.reduce((acc, n) => {
    acc[n.rawNode.id] = n;
    return acc;
  }, {});
  edges.forEach((e) => {
    e.source.set(nodesById[e.edge.source]);
    e.target.set(nodesById[e.edge.target]);
  });
}
function isCallable(fn) {
  try {
    new Proxy(fn, {
      apply: () => void 0
    })();
    return true;
  } catch (err) {
    return false;
  }
}
var ComponentEventBusService = class _ComponentEventBusService {
  constructor() {
    this._event$ = new Subject();
    this.event$ = this._event$.asObservable();
  }
  pushEvent(event) {
    this._event$.next(event);
  }
  static {
    this.ɵfac = function ComponentEventBusService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _ComponentEventBusService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _ComponentEventBusService,
      factory: _ComponentEventBusService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ComponentEventBusService, [{
    type: Injectable
  }], null, null);
})();
var NodeAccessorService = class _NodeAccessorService {
  constructor() {
    this.model = signal(null);
  }
  static {
    this.ɵfac = function NodeAccessorService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _NodeAccessorService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _NodeAccessorService,
      factory: _NodeAccessorService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(NodeAccessorService, [{
    type: Injectable
  }], null, null);
})();
var CustomNodeBaseComponent = class _CustomNodeBaseComponent {
  constructor() {
    this.eventBus = inject(ComponentEventBusService);
    this.nodeService = inject(NodeAccessorService);
    this.destroyRef = inject(DestroyRef);
    this.selected = this.nodeService.model().selected;
    this.data = signal(void 0);
  }
  ngOnInit() {
    this.trackEvents().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
  trackEvents() {
    const props = Object.getOwnPropertyNames(this);
    const emittersOrRefs = /* @__PURE__ */ new Map();
    for (const prop of props) {
      const field = this[prop];
      if (field instanceof EventEmitter) {
        emittersOrRefs.set(field, prop);
      }
      if (field instanceof OutputEmitterRef) {
        emittersOrRefs.set(outputRefToObservable(field), prop);
      }
    }
    return merge(...Array.from(emittersOrRefs.keys()).map((emitter) => emitter.pipe(tap((event) => {
      this.eventBus.pushEvent({
        nodeId: this.nodeService.model()?.rawNode.id ?? "",
        eventName: emittersOrRefs.get(emitter),
        eventPayload: event
      });
    }))));
  }
  static {
    this.ɵfac = function CustomNodeBaseComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _CustomNodeBaseComponent)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _CustomNodeBaseComponent,
      standalone: false
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(CustomNodeBaseComponent, [{
    type: Directive
  }], null, null);
})();
function outputRefToObservable(ref) {
  return new Observable((subscriber) => {
    const subscription = ref.subscribe((value) => {
      subscriber.next(value);
    });
    return () => {
      subscription.unsubscribe();
    };
  });
}
var CustomDynamicNodeComponent = class _CustomDynamicNodeComponent extends CustomNodeBaseComponent {
  constructor() {
    super(...arguments);
    this.node = input.required();
  }
  ngOnInit() {
    const data = this.node().data;
    if (data) {
      this.data = data;
    }
    super.ngOnInit();
  }
  static {
    this.ɵfac = /* @__PURE__ */ (() => {
      let ɵCustomDynamicNodeComponent_BaseFactory;
      return function CustomDynamicNodeComponent_Factory(__ngFactoryType__) {
        return (ɵCustomDynamicNodeComponent_BaseFactory || (ɵCustomDynamicNodeComponent_BaseFactory = ɵɵgetInheritedFactory(_CustomDynamicNodeComponent)))(__ngFactoryType__ || _CustomDynamicNodeComponent);
      };
    })();
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _CustomDynamicNodeComponent,
      inputs: {
        node: [1, "node"]
      },
      standalone: false,
      features: [ɵɵInheritDefinitionFeature]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(CustomDynamicNodeComponent, [{
    type: Directive
  }], null, null);
})();
var CustomNodeComponent = class _CustomNodeComponent extends CustomNodeBaseComponent {
  constructor() {
    super(...arguments);
    this.node = input.required();
  }
  ngOnInit() {
    if (this.node().data) {
      this.data.set(this.node().data);
    }
    super.ngOnInit();
  }
  static {
    this.ɵfac = /* @__PURE__ */ (() => {
      let ɵCustomNodeComponent_BaseFactory;
      return function CustomNodeComponent_Factory(__ngFactoryType__) {
        return (ɵCustomNodeComponent_BaseFactory || (ɵCustomNodeComponent_BaseFactory = ɵɵgetInheritedFactory(_CustomNodeComponent)))(__ngFactoryType__ || _CustomNodeComponent);
      };
    })();
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _CustomNodeComponent,
      inputs: {
        node: [1, "node"]
      },
      standalone: false,
      features: [ɵɵInheritDefinitionFeature]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(CustomNodeComponent, [{
    type: Directive
  }], null, null);
})();
function isCustomNodeComponent(type) {
  return Object.prototype.isPrototypeOf.call(CustomNodeComponent, type);
}
function isCustomDynamicNodeComponent(type) {
  return Object.prototype.isPrototypeOf.call(CustomDynamicNodeComponent, type);
}
function isStaticNode(node) {
  return typeof node.point !== "function";
}
function isDynamicNode(node) {
  return typeof node.point === "function";
}
function isComponentStaticNode(node) {
  if (isCustomNodeComponent(node.type)) {
    return true;
  }
  return isCallable(node.type) && !isCallable(node.point);
}
function isComponentDynamicNode(node) {
  if (isCustomDynamicNodeComponent(node.type)) {
    return true;
  }
  return isCallable(node.type) && isCallable(node.point);
}
function isTemplateStaticNode(node) {
  return node.type === "html-template";
}
function isTemplateDynamicNode(node) {
  return node.type === "html-template";
}
function isSvgTemplateStaticNode(node) {
  return node.type === "svg-template";
}
function isSvgTemplateDynamicNode(node) {
  return node.type === "html-template";
}
function isDefaultStaticNode(node) {
  return node.type === "default";
}
function isDefaultDynamicNode(node) {
  return node.type === "default";
}
function isDefaultStaticGroupNode(node) {
  return node.type === "default-group";
}
function isDefaultDynamicGroupNode(node) {
  return node.type === "default-group";
}
function isTemplateStaticGroupNode(node) {
  return node.type === "template-group";
}
function isTemplateDynamicGroupNode(node) {
  return node.type === "template-group";
}
var MAGIC_NUMBER_TO_FIX_GLITCH_IN_CHROME = 2;
function toUnifiedNode(node) {
  if (isDynamicNode(node)) {
    return node;
  }
  return __spreadProps(__spreadValues({}, toSignalProperties(node)), {
    // non-signal props below
    id: node.id,
    // TODO this actually of incorrect type for component nodes
    type: node.type
  });
}
function toSignalProperties(obj) {
  const newObj = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      newObj[key] = signal(obj[key]);
    }
  }
  return newObj;
}
function assertInjector(fn, injector, runner) {
  !injector && assertInInjectionContext(fn);
  const assertedInjector = injector ?? inject(Injector);
  if (!runner) return assertedInjector;
  return runInInjectionContext(assertedInjector, runner);
}
function toLazySignal(source, options) {
  const injector = assertInjector(toLazySignal, options?.injector);
  let s;
  return computed(() => {
    if (!s) {
      s = untracked(() => toSignal(source, __spreadProps(__spreadValues({}, options), {
        injector
      })));
    }
    return s();
  });
}
function isGroupNode(node) {
  return node.rawNode.type === "default-group" || node.rawNode.type === "template-group";
}
var NodeRenderingService = class _NodeRenderingService {
  constructor() {
    this.flowEntitiesService = inject(FlowEntitiesService);
    this.flowSettingsService = inject(FlowSettingsService);
    this.viewportService = inject(ViewportService);
    this.nodes = computed(() => {
      if (!this.flowSettingsService.optimization().virtualization) {
        return [...this.flowEntitiesService.nodes()].sort((aNode, bNode) => aNode.renderOrder() - bNode.renderOrder());
      }
      return this.viewportNodesAfterInteraction().sort((aNode, bNode) => aNode.renderOrder() - bNode.renderOrder());
    });
    this.groups = computed(() => {
      return this.nodes().filter((n) => !!n.children().length || isGroupNode(n));
    });
    this.nonGroups = computed(() => {
      return this.nodes().filter((n) => !this.groups().includes(n));
    });
    this.viewportNodes = computed(() => {
      const nodes = this.flowEntitiesService.nodes();
      const viewport = this.viewportService.readableViewport();
      const flowWidth = this.flowSettingsService.computedFlowWidth();
      const flowHeight = this.flowSettingsService.computedFlowHeight();
      return nodes.filter((n) => {
        const {
          x,
          y
        } = n.globalPoint();
        const width = n.width();
        const height = n.height();
        return isRectInViewport({
          x,
          y,
          width,
          height
        }, viewport, flowWidth, flowHeight);
      });
    });
    this.viewportNodesAfterInteraction = toLazySignal(merge(
      // TODO: maybe there is a better way wait when viewport is ready?
      // (to correctly calculate viewport nodes on first render)
      toObservable(this.flowEntitiesService.nodes).pipe(observeOn(asyncScheduler), filter((nodes) => !!nodes.length)),
      this.viewportService.viewportChangeEnd$.pipe(debounceTime(300))
    ).pipe(map(() => {
      const viewport = this.viewportService.readableViewport();
      const zoomThreshold = this.flowSettingsService.optimization().virtualizationZoomThreshold;
      return viewport.zoom < zoomThreshold ? [] : this.viewportNodes();
    })), {
      initialValue: []
    });
    this.maxOrder = computed(() => {
      return Math.max(...this.flowEntitiesService.nodes().map((n) => n.renderOrder()));
    });
  }
  pullNode(node) {
    node.renderOrder.set(this.maxOrder() + 1);
    node.children().forEach((n) => this.pullNode(n));
  }
  static {
    this.ɵfac = function NodeRenderingService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _NodeRenderingService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _NodeRenderingService,
      factory: _NodeRenderingService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(NodeRenderingService, [{
    type: Injectable
  }], null, null);
})();
function extendedComputed(computedCallback, options) {
  if (!options) {
    options = {
      equal: Object.is
    };
  }
  let currentValue = void 0;
  return computed(() => {
    return currentValue = computedCallback(currentValue);
  }, options);
}
var NodeModel = class _NodeModel {
  static {
    this.defaultWidth = 100;
  }
  static {
    this.defaultHeight = 50;
  }
  static {
    this.defaultColor = "#1b262c";
  }
  constructor(rawNode) {
    this.rawNode = rawNode;
    this.entitiesService = inject(FlowEntitiesService);
    this.settingsService = inject(FlowSettingsService);
    this.nodeRenderingService = inject(NodeRenderingService);
    this.isVisible = signal(false);
    this.point = signal({
      x: 0,
      y: 0
    });
    this.width = signal(_NodeModel.defaultWidth);
    this.height = signal(_NodeModel.defaultHeight);
    this.size = computed(() => ({
      width: this.width(),
      height: this.height()
    }));
    this.styleWidth = computed(() => this.controlledByResizer() ? `${this.width()}px` : "100%");
    this.styleHeight = computed(() => this.controlledByResizer() ? `${this.height()}px` : "100%");
    this.foWidth = computed(() => this.width() + MAGIC_NUMBER_TO_FIX_GLITCH_IN_CHROME);
    this.foHeight = computed(() => this.height() + MAGIC_NUMBER_TO_FIX_GLITCH_IN_CHROME);
    this.renderOrder = signal(0);
    this.selected = signal(false);
    this.preview = signal({
      style: {}
    });
    this.globalPoint = computed(() => {
      let parent = this.parent();
      let x = this.point().x;
      let y = this.point().y;
      while (parent !== null) {
        x += parent.point().x;
        y += parent.point().y;
        parent = parent.parent();
      }
      return {
        x,
        y
      };
    });
    this.pointTransform = computed(() => `translate(${this.globalPoint().x}, ${this.globalPoint().y})`);
    this.handles = signal([]);
    this.draggable = signal(true);
    this.dragHandlesCount = signal(0);
    this.magnetRadius = 20;
    this.isComponentType = isComponentStaticNode(this.rawNode) || isComponentDynamicNode(this.rawNode);
    this.shouldLoad = extendedComputed((previousShouldLoad) => {
      if (previousShouldLoad) {
        return true;
      }
      if (this.settingsService.optimization().lazyLoadTrigger === "immediate") {
        return true;
      } else if (this.settingsService.optimization().lazyLoadTrigger === "viewport") {
        if (isCustomNodeComponent(this.rawNode.type)) {
          return true;
        }
        if (isCustomDynamicNodeComponent(this.rawNode.type)) {
          return true;
        }
        if (isCallable(this.rawNode.type) || this.rawNode.type === "html-template" || this.rawNode.type === "svg-template" || this.rawNode.type === "template-group") {
          return this.nodeRenderingService.viewportNodes().includes(this);
        }
      }
      return true;
    });
    this.componentInstance$ = toObservable(this.shouldLoad).pipe(
      filter(Boolean),
      // @ts-expect-error we assume it's a function with dynamic import
      switchMap(() => this.rawNode.type()),
      catchError(() => of(this.rawNode.type)),
      shareReplay(1)
    );
    this.text = signal("");
    this.componentTypeInputs = {
      node: this.rawNode
    };
    this.parent = computed(() => this.entitiesService.nodes().find((n) => n.rawNode.id === this.parentId()) ?? null);
    this.children = computed(() => this.entitiesService.nodes().filter((n) => n.parentId() === this.rawNode.id));
    this.color = signal(_NodeModel.defaultColor);
    this.controlledByResizer = signal(false);
    this.resizable = signal(false);
    this.resizing = signal(false);
    this.resizerTemplate = signal(null);
    this.context = {
      $implicit: {}
    };
    this.parentId = signal(null);
    const internalNode = toUnifiedNode(rawNode);
    if (internalNode.point) {
      this.point = internalNode.point;
    }
    if (internalNode.width) {
      this.width = internalNode.width;
    }
    if (internalNode.height) {
      this.height = internalNode.height;
    }
    if (internalNode.draggable) {
      this.draggable = internalNode.draggable;
    }
    if (internalNode.parentId) {
      this.parentId = internalNode.parentId;
    }
    if (internalNode.preview) {
      this.preview = internalNode.preview;
    }
    if (internalNode.type === "default-group" && internalNode.color) {
      this.color = internalNode.color;
    }
    if (internalNode.type === "default-group" && internalNode.resizable) {
      this.resizable = internalNode.resizable;
    }
    if (internalNode.type === "default" && internalNode.text) {
      this.text = internalNode.text;
    }
    if (internalNode.type === "html-template") {
      this.context = {
        $implicit: {
          node: rawNode,
          selected: this.selected.asReadonly(),
          shouldLoad: this.shouldLoad
        }
      };
    }
    if (internalNode.type === "svg-template") {
      this.context = {
        $implicit: {
          node: rawNode,
          selected: this.selected.asReadonly(),
          width: this.width.asReadonly(),
          height: this.height.asReadonly(),
          shouldLoad: this.shouldLoad
        }
      };
    }
    if (internalNode.type === "template-group") {
      this.context = {
        $implicit: {
          node: rawNode,
          selected: this.selected.asReadonly(),
          width: this.width.asReadonly(),
          height: this.height.asReadonly(),
          shouldLoad: this.shouldLoad
        }
      };
    }
    this.point$ = toObservable(this.point);
    this.width$ = toObservable(this.width);
    this.height$ = toObservable(this.height);
    this.size$ = toObservable(this.size);
    this.selected$ = toObservable(this.selected);
    this.handles$ = toObservable(this.handles);
  }
  setPoint(point) {
    this.point.set(point);
  }
};
var EdgeLabelModel = class {
  constructor(edgeLabel) {
    this.edgeLabel = edgeLabel;
    this.size = signal({
      width: 0,
      height: 0
    });
  }
};
function getPointOnLineByRatio(start2, end, ratio) {
  return {
    x: (1 - ratio) * start2.x + ratio * end.x,
    y: (1 - ratio) * start2.y + ratio * end.y
  };
}
function straightPath({
  sourcePoint,
  targetPoint
}) {
  return {
    path: `M ${sourcePoint.x},${sourcePoint.y}L ${targetPoint.x},${targetPoint.y}`,
    labelPoints: {
      start: getPointOnLineByRatio(sourcePoint, targetPoint, 0.15),
      center: getPointOnLineByRatio(sourcePoint, targetPoint, 0.5),
      end: getPointOnLineByRatio(sourcePoint, targetPoint, 0.85)
    }
  };
}
function bezierPath({
  sourcePoint,
  targetPoint,
  sourcePosition,
  targetPosition
}) {
  const distanceVector = {
    x: sourcePoint.x - targetPoint.x,
    y: sourcePoint.y - targetPoint.y
  };
  const sourceControl = calcControlPoint(sourcePoint, sourcePosition, distanceVector);
  const targetControl = calcControlPoint(targetPoint, targetPosition, distanceVector);
  const path = `M${sourcePoint.x},${sourcePoint.y} C${sourceControl.x},${sourceControl.y} ${targetControl.x},${targetControl.y} ${targetPoint.x},${targetPoint.y}`;
  return getPathData(path, sourcePoint, targetPoint, sourceControl, targetControl);
}
function calcControlPoint(point, pointPosition, distanceVector) {
  const factorPoint = {
    x: 0,
    y: 0
  };
  switch (pointPosition) {
    case "top":
      factorPoint.y = 1;
      break;
    case "bottom":
      factorPoint.y = -1;
      break;
    case "right":
      factorPoint.x = 1;
      break;
    case "left":
      factorPoint.x = -1;
      break;
  }
  const fullDistanceVector = {
    x: distanceVector.x * Math.abs(factorPoint.x),
    y: distanceVector.y * Math.abs(factorPoint.y)
  };
  const curvature = 0.25;
  const controlOffset = curvature * 25 * Math.sqrt(Math.abs(fullDistanceVector.x + fullDistanceVector.y));
  return {
    x: point.x + factorPoint.x * controlOffset,
    y: point.y - factorPoint.y * controlOffset
  };
}
function getPathData(path, source, target, sourceControl, targetControl) {
  return {
    path,
    labelPoints: {
      start: getPointOnBezier(source, target, sourceControl, targetControl, 0.1),
      center: getPointOnBezier(source, target, sourceControl, targetControl, 0.5),
      end: getPointOnBezier(source, target, sourceControl, targetControl, 0.9)
    }
  };
}
function getPointOnBezier(sourcePoint, targetPoint, sourceControl, targetControl, ratio) {
  const fromSourceToFirstControl = getPointOnLineByRatio(sourcePoint, sourceControl, ratio);
  const fromFirstControlToSecond = getPointOnLineByRatio(sourceControl, targetControl, ratio);
  const fromSecondControlToTarget = getPointOnLineByRatio(targetControl, targetPoint, ratio);
  return getPointOnLineByRatio(getPointOnLineByRatio(fromSourceToFirstControl, fromFirstControlToSecond, ratio), getPointOnLineByRatio(fromFirstControlToSecond, fromSecondControlToTarget, ratio), ratio);
}
var handleDirections = {
  left: {
    x: -1,
    y: 0
  },
  right: {
    x: 1,
    y: 0
  },
  top: {
    x: 0,
    y: -1
  },
  bottom: {
    x: 0,
    y: 1
  }
};
function getEdgeCenter(source, target) {
  const xOffset = Math.abs(target.x - source.x) / 2;
  const centerX = target.x < source.x ? target.x + xOffset : target.x - xOffset;
  const yOffset = Math.abs(target.y - source.y) / 2;
  const centerY = target.y < source.y ? target.y + yOffset : target.y - yOffset;
  return [centerX, centerY, xOffset, yOffset];
}
var getDirection = ({
  source,
  sourcePosition = "bottom",
  target
}) => {
  if (sourcePosition === "left" || sourcePosition === "right") {
    return source.x < target.x ? {
      x: 1,
      y: 0
    } : {
      x: -1,
      y: 0
    };
  }
  return source.y < target.y ? {
    x: 0,
    y: 1
  } : {
    x: 0,
    y: -1
  };
};
var distance = (a, b) => Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
function getPoints({
  source,
  sourcePosition = "bottom",
  target,
  targetPosition = "top",
  offset
}) {
  const sourceDir = handleDirections[sourcePosition];
  const targetDir = handleDirections[targetPosition];
  const sourceGapped = {
    x: source.x + sourceDir.x * offset,
    y: source.y + sourceDir.y * offset
  };
  const targetGapped = {
    x: target.x + targetDir.x * offset,
    y: target.y + targetDir.y * offset
  };
  const dir = getDirection({
    source: sourceGapped,
    sourcePosition,
    target: targetGapped
  });
  const dirAccessor = dir.x !== 0 ? "x" : "y";
  const currDir = dir[dirAccessor];
  let points = [];
  let centerX, centerY;
  const sourceGapOffset = {
    x: 0,
    y: 0
  };
  const targetGapOffset = {
    x: 0,
    y: 0
  };
  const [defaultCenterX, defaultCenterY] = getEdgeCenter(source, target);
  if (sourceDir[dirAccessor] * targetDir[dirAccessor] === -1) {
    centerX = defaultCenterX;
    centerY = defaultCenterY;
    const verticalSplit = [{
      x: centerX,
      y: sourceGapped.y
    }, {
      x: centerX,
      y: targetGapped.y
    }];
    const horizontalSplit = [{
      x: sourceGapped.x,
      y: centerY
    }, {
      x: targetGapped.x,
      y: centerY
    }];
    if (sourceDir[dirAccessor] === currDir) {
      points = dirAccessor === "x" ? verticalSplit : horizontalSplit;
    } else {
      points = dirAccessor === "x" ? horizontalSplit : verticalSplit;
    }
  } else {
    const sourceTarget = [{
      x: sourceGapped.x,
      y: targetGapped.y
    }];
    const targetSource = [{
      x: targetGapped.x,
      y: sourceGapped.y
    }];
    if (dirAccessor === "x") {
      points = sourceDir.x === currDir ? targetSource : sourceTarget;
    } else {
      points = sourceDir.y === currDir ? sourceTarget : targetSource;
    }
    if (sourcePosition === targetPosition) {
      const diff = Math.abs(source[dirAccessor] - target[dirAccessor]);
      if (diff <= offset) {
        const gapOffset = Math.min(offset - 1, offset - diff);
        if (sourceDir[dirAccessor] === currDir) {
          sourceGapOffset[dirAccessor] = (sourceGapped[dirAccessor] > source[dirAccessor] ? -1 : 1) * gapOffset;
        } else {
          targetGapOffset[dirAccessor] = (targetGapped[dirAccessor] > target[dirAccessor] ? -1 : 1) * gapOffset;
        }
      }
    }
    if (sourcePosition !== targetPosition) {
      const dirAccessorOpposite = dirAccessor === "x" ? "y" : "x";
      const isSameDir = sourceDir[dirAccessor] === targetDir[dirAccessorOpposite];
      const sourceGtTargetOppo = sourceGapped[dirAccessorOpposite] > targetGapped[dirAccessorOpposite];
      const sourceLtTargetOppo = sourceGapped[dirAccessorOpposite] < targetGapped[dirAccessorOpposite];
      const flipSourceTarget = sourceDir[dirAccessor] === 1 && (!isSameDir && sourceGtTargetOppo || isSameDir && sourceLtTargetOppo) || sourceDir[dirAccessor] !== 1 && (!isSameDir && sourceLtTargetOppo || isSameDir && sourceGtTargetOppo);
      if (flipSourceTarget) {
        points = dirAccessor === "x" ? sourceTarget : targetSource;
      }
    }
    const sourceGapPoint = {
      x: sourceGapped.x + sourceGapOffset.x,
      y: sourceGapped.y + sourceGapOffset.y
    };
    const targetGapPoint = {
      x: targetGapped.x + targetGapOffset.x,
      y: targetGapped.y + targetGapOffset.y
    };
    const maxXDistance = Math.max(Math.abs(sourceGapPoint.x - points[0].x), Math.abs(targetGapPoint.x - points[0].x));
    const maxYDistance = Math.max(Math.abs(sourceGapPoint.y - points[0].y), Math.abs(targetGapPoint.y - points[0].y));
    if (maxXDistance >= maxYDistance) {
      centerX = (sourceGapPoint.x + targetGapPoint.x) / 2;
      centerY = points[0].y;
    } else {
      centerX = points[0].x;
      centerY = (sourceGapPoint.y + targetGapPoint.y) / 2;
    }
  }
  const pathPoints = [source, {
    x: sourceGapped.x + sourceGapOffset.x,
    y: sourceGapped.y + sourceGapOffset.y
  }, ...points, {
    x: targetGapped.x + targetGapOffset.x,
    y: targetGapped.y + targetGapOffset.y
  }, target];
  return [pathPoints, centerX, centerY];
}
function getBend(a, b, c, size) {
  const bendSize = Math.min(distance(a, b) / 2, distance(b, c) / 2, size);
  const {
    x,
    y
  } = b;
  if (a.x === x && x === c.x || a.y === y && y === c.y) {
    return `L${x} ${y}`;
  }
  if (a.y === y) {
    const xDir2 = a.x < c.x ? -1 : 1;
    const yDir2 = a.y < c.y ? 1 : -1;
    return `L ${x + bendSize * xDir2},${y}Q ${x},${y} ${x},${y + bendSize * yDir2}`;
  }
  const xDir = a.x < c.x ? 1 : -1;
  const yDir = a.y < c.y ? -1 : 1;
  return `L ${x},${y + bendSize * yDir}Q ${x},${y} ${x + bendSize * xDir},${y}`;
}
function smoothStepPath({
  sourcePoint,
  targetPoint,
  sourcePosition,
  targetPosition
}, borderRadius2 = 5) {
  const [points, labelX, labelY] = getPoints({
    source: sourcePoint,
    sourcePosition,
    target: targetPoint,
    targetPosition,
    offset: 20
  });
  const path = points.reduce((res, p, i) => {
    let segment = "";
    if (i > 0 && i < points.length - 1) {
      segment = getBend(points[i - 1], p, points[i + 1], borderRadius2);
    } else {
      segment = `${i === 0 ? "M" : "L"}${p.x} ${p.y}`;
    }
    res += segment;
    return res;
  }, "");
  const n = points.length;
  if (n < 2) {
    return {
      path,
      labelPoints: {
        start: {
          x: labelX,
          y: labelY
        },
        center: {
          x: labelX,
          y: labelY
        },
        end: {
          x: labelX,
          y: labelY
        }
      }
    };
  }
  const segmentLengths = new Array(n - 1);
  const cumulativeDistances = new Array(n);
  cumulativeDistances[0] = 0;
  let totalLength = 0;
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segmentLengths[i] = len;
    totalLength += len;
    cumulativeDistances[i + 1] = totalLength;
  }
  const getPointAtRatio = (ratio) => {
    const targetDistance = totalLength * ratio;
    if (targetDistance <= 0) return points[0];
    if (targetDistance >= totalLength) return points[n - 1];
    let low = 0;
    let high = n - 1;
    while (low < high - 1) {
      const mid = low + high >>> 1;
      if (cumulativeDistances[mid] < targetDistance) {
        low = mid;
      } else {
        high = mid;
      }
    }
    const segmentStartDistance = cumulativeDistances[low];
    const localDistance = targetDistance - segmentStartDistance;
    const t = localDistance / segmentLengths[low];
    const start2 = points[low];
    const end = points[low + 1];
    return {
      x: start2.x + (end.x - start2.x) * t,
      y: start2.y + (end.y - start2.y) * t
    };
  };
  return {
    path,
    labelPoints: {
      start: getPointAtRatio(0.15),
      center: {
        x: labelX,
        y: labelY
      },
      end: getPointAtRatio(0.85)
    }
  };
}
var EdgeModel = class {
  constructor(edge) {
    this.edge = edge;
    this.flowEntitiesService = inject(FlowEntitiesService);
    this.source = signal(void 0);
    this.target = signal(void 0);
    this.selected = signal(false);
    this.selected$ = toObservable(this.selected);
    this.shouldLoad = computed(() => (this.source()?.shouldLoad() ?? false) && (this.target()?.shouldLoad() ?? false));
    this.renderOrder = signal(0);
    this.detached = computed(() => {
      const source = this.source();
      const target = this.target();
      if (!source || !target) {
        return true;
      }
      let existsSourceHandle = false;
      let existsTargetHandle = false;
      if (this.edge.sourceHandle) {
        existsSourceHandle = !!source.handles().find((handle) => handle.rawHandle.id === this.edge.sourceHandle);
      } else {
        existsSourceHandle = !!source.handles().find((handle) => handle.rawHandle.type === "source");
      }
      if (this.edge.targetHandle) {
        existsTargetHandle = !!target.handles().find((handle) => handle.rawHandle.id === this.edge.targetHandle);
      } else {
        existsTargetHandle = !!target.handles().find((handle) => handle.rawHandle.type === "target");
      }
      return !existsSourceHandle || !existsTargetHandle;
    });
    this.detached$ = toObservable(this.detached);
    this.path = computed(() => {
      const source = this.sourceHandle();
      const target = this.targetHandle();
      if (!source || !target) {
        return {
          path: ""
        };
      }
      const params = this.getPathFactoryParams(source, target);
      switch (this.curve) {
        case "straight":
          return straightPath(params);
        case "bezier":
          return bezierPath(params);
        case "smooth-step":
          return smoothStepPath(params);
        case "step":
          return smoothStepPath(params, 0);
        default:
          return this.curve(params);
      }
    });
    this.sourceHandle = extendedComputed((previousHandle) => {
      let handle = null;
      if (this.floating) {
        handle = this.closestHandles().sourceHandle;
      } else {
        if (this.edge.sourceHandle) {
          handle = this.source()?.handles().find((handle2) => handle2.rawHandle.id === this.edge.sourceHandle) ?? null;
        } else {
          handle = this.source()?.handles().find((handle2) => handle2.rawHandle.type === "source") ?? null;
        }
      }
      if (handle === null) {
        return previousHandle;
      }
      return handle;
    });
    this.targetHandle = extendedComputed((previousHandle) => {
      let handle = null;
      if (this.floating) {
        handle = this.closestHandles().targetHandle;
      } else {
        if (this.edge.targetHandle) {
          handle = this.target()?.handles().find((handle2) => handle2.rawHandle.id === this.edge.targetHandle) ?? null;
        } else {
          handle = this.target()?.handles().find((handle2) => handle2.rawHandle.type === "target") ?? null;
        }
      }
      if (handle === null) {
        return previousHandle;
      }
      return handle;
    });
    this.closestHandles = computed(() => {
      const source = this.source();
      const target = this.target();
      if (!source || !target) {
        return {
          sourceHandle: null,
          targetHandle: null
        };
      }
      const sourceHandles = this.flowEntitiesService.connection().mode === "strict" ? source.handles().filter((h) => h.rawHandle.type === "source") : source.handles();
      const targetHandles = this.flowEntitiesService.connection().mode === "strict" ? target.handles().filter((h) => h.rawHandle.type === "target") : target.handles();
      if (sourceHandles.length === 0 || targetHandles.length === 0) {
        return {
          sourceHandle: null,
          targetHandle: null
        };
      }
      let minDistance = Infinity;
      let closestSourceHandle = null;
      let closestTargetHandle = null;
      for (const sourceHandle of sourceHandles) {
        for (const targetHandle of targetHandles) {
          const sourcePoint = sourceHandle.pointAbsolute();
          const targetPoint = targetHandle.pointAbsolute();
          const distance2 = Math.sqrt(Math.pow(sourcePoint.x - targetPoint.x, 2) + Math.pow(sourcePoint.y - targetPoint.y, 2));
          if (distance2 < minDistance) {
            minDistance = distance2;
            closestSourceHandle = sourceHandle;
            closestTargetHandle = targetHandle;
          }
        }
      }
      return {
        sourceHandle: closestSourceHandle,
        targetHandle: closestTargetHandle
      };
    });
    this.markerStartUrl = computed(() => {
      const marker = this.edge.markers?.start;
      return marker ? `url(#${hashCode(JSON.stringify(marker))})` : "";
    });
    this.markerEndUrl = computed(() => {
      const marker = this.edge.markers?.end;
      return marker ? `url(#${hashCode(JSON.stringify(marker))})` : "";
    });
    this.context = {
      $implicit: {
        // TODO: check if edge could change
        edge: this.edge,
        path: computed(() => this.path().path),
        markerStart: this.markerStartUrl,
        markerEnd: this.markerEndUrl,
        selected: this.selected.asReadonly(),
        shouldLoad: this.shouldLoad
      }
    };
    this.edgeLabels = {};
    this.type = edge.type ?? "default";
    this.curve = edge.curve ?? "bezier";
    this.reconnectable = edge.reconnectable ?? false;
    this.floating = edge.floating ?? false;
    if (edge.edgeLabels?.start) this.edgeLabels.start = new EdgeLabelModel(edge.edgeLabels.start);
    if (edge.edgeLabels?.center) this.edgeLabels.center = new EdgeLabelModel(edge.edgeLabels.center);
    if (edge.edgeLabels?.end) this.edgeLabels.end = new EdgeLabelModel(edge.edgeLabels.end);
  }
  getPathFactoryParams(source, target) {
    return {
      mode: "edge",
      edge: this.edge,
      sourcePoint: source.pointAbsolute(),
      targetPoint: target.pointAbsolute(),
      sourcePosition: source.rawHandle.position,
      targetPosition: target.rawHandle.position,
      allEdges: this.flowEntitiesService.rawEdges(),
      allNodes: this.flowEntitiesService.rawNodes()
    };
  }
};
var ReferenceIdentityChecker = class {
  /**
   * Create new models for new node references and keep old models for old node references
   */
  static nodes(newNodes, oldNodeModels) {
    const oldNodesMap = /* @__PURE__ */ new Map();
    oldNodeModels.forEach((model) => oldNodesMap.set(model.rawNode, model));
    return newNodes.map((newNode) => {
      return oldNodesMap.get(newNode) ?? new NodeModel(newNode);
    });
  }
  /**
   * Create new models for new edge references and keep old models for old edge references
   */
  static edges(newEdges, oldEdgeModels) {
    const oldEdgesMap = /* @__PURE__ */ new Map();
    oldEdgeModels.forEach((model) => oldEdgesMap.set(model.edge, model));
    return newEdges.map((newEdge) => {
      if (oldEdgesMap.has(newEdge)) return oldEdgesMap.get(newEdge);
      else return new EdgeModel(newEdge);
    });
  }
};
var DELAY_FOR_SCHEDULER = 25;
var NodesChangeService = class _NodesChangeService {
  constructor() {
    this.entitiesService = inject(FlowEntitiesService);
    this.nodesPositionChange$ = toObservable(this.entitiesService.nodes).pipe(
      // Check for nodes list change and watch for specific node from this list change its position
      switchMap((nodes) => merge(...nodes.map((node) => node.point$.pipe(
        // skip initial position from signal
        skip(1),
        map(() => node)
      )))),
      map((changedNode) => {
        return [
          {
            type: "position",
            id: changedNode.rawNode.id,
            point: changedNode.point()
          },
          // TODO: emits even if node is not change position
          ...this.entitiesService.nodes().filter((node) => node !== changedNode && node.selected()).map((node) => ({
            type: "position",
            id: node.rawNode.id,
            point: node.point()
          }))
        ];
      })
    );
    this.nodeSizeChange$ = toObservable(this.entitiesService.nodes).pipe(switchMap((nodes) => merge(...nodes.map((node) => node.size$.pipe(skip(1), map(() => node))))), map((changedNode) => [{
      type: "size",
      id: changedNode.rawNode.id,
      size: changedNode.size()
    }]));
    this.nodeAddChange$ = toObservable(this.entitiesService.nodes).pipe(pairwise(), map(([oldList, newList]) => newList.filter((node) => !oldList.includes(node))), filter((nodes) => !!nodes.length), map((nodes) => nodes.map((node) => ({
      type: "add",
      id: node.rawNode.id
    }))));
    this.nodeRemoveChange$ = toObservable(this.entitiesService.nodes).pipe(pairwise(), map(([oldList, newList]) => oldList.filter((node) => !newList.includes(node))), filter((nodes) => !!nodes.length), map((nodes) => nodes.map((node) => ({
      type: "remove",
      id: node.rawNode.id
    }))));
    this.nodeSelectedChange$ = toObservable(this.entitiesService.nodes).pipe(switchMap((nodes) => merge(...nodes.map((node) => node.selected$.pipe(distinctUntilChanged(), skip(1), map(() => node))))), map((changedNode) => [{
      type: "select",
      id: changedNode.rawNode.id,
      selected: changedNode.selected()
    }]));
    this.changes$ = merge(this.nodesPositionChange$, this.nodeSizeChange$, this.nodeAddChange$, this.nodeRemoveChange$, this.nodeSelectedChange$).pipe(
      // this fixes a bug when on fire node event change,
      // you can't get valid list of detached edges
      observeOn(asyncScheduler, DELAY_FOR_SCHEDULER)
    );
  }
  static {
    this.ɵfac = function NodesChangeService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _NodesChangeService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _NodesChangeService,
      factory: _NodesChangeService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(NodesChangeService, [{
    type: Injectable
  }], null, null);
})();
var haveSameContents = (a, b) => a.length === b.length && [.../* @__PURE__ */ new Set([...a, ...b])].every((v) => a.filter((e) => e === v).length === b.filter((e) => e === v).length);
var EdgeChangesService = class _EdgeChangesService {
  constructor() {
    this.entitiesService = inject(FlowEntitiesService);
    this.edgeDetachedChange$ = merge(toObservable(computed(() => {
      const nodes = this.entitiesService.nodes();
      const edges = untracked(this.entitiesService.edges);
      return edges.filter(({
        source,
        target
      }) => !nodes.includes(source()) || !nodes.includes(target()));
    })), toObservable(this.entitiesService.edges).pipe(
      switchMap((edges) => {
        return zip(...edges.map((e) => e.detached$.pipe(map(() => e))));
      }),
      map((edges) => edges.filter((e) => e.detached())),
      // TODO check why there are 2 emits
      skip(2)
    )).pipe(
      // here we check if 2 approaches to detect detached edges emits same
      // and same values (this may happen on node delete)
      distinctUntilChanged(haveSameContents),
      filter((edges) => !!edges.length),
      map((edges) => edges.map(({
        edge
      }) => ({
        type: "detached",
        id: edge.id
      })))
    );
    this.edgeAddChange$ = toObservable(this.entitiesService.edges).pipe(pairwise(), map(([oldList, newList]) => {
      return newList.filter((edge) => !oldList.includes(edge));
    }), filter((edges) => !!edges.length), map((edges) => edges.map(({
      edge
    }) => ({
      type: "add",
      id: edge.id
    }))));
    this.edgeRemoveChange$ = toObservable(this.entitiesService.edges).pipe(pairwise(), map(([oldList, newList]) => {
      return oldList.filter((edge) => !newList.includes(edge));
    }), filter((edges) => !!edges.length), map((edges) => edges.map(({
      edge
    }) => ({
      type: "remove",
      id: edge.id
    }))));
    this.edgeSelectChange$ = toObservable(this.entitiesService.edges).pipe(switchMap((edges) => merge(...edges.map((edge) => edge.selected$.pipe(distinctUntilChanged(), skip(1), map(() => edge))))), map((changedEdge) => [{
      type: "select",
      id: changedEdge.edge.id,
      selected: changedEdge.selected()
    }]));
    this.changes$ = merge(this.edgeDetachedChange$, this.edgeAddChange$, this.edgeRemoveChange$, this.edgeSelectChange$).pipe(
      // this fixes the case when user gets 'deteched' changes
      // and tries to delete these edges inside stream
      // angular may ignore this change because [edges] input changed
      // right after [nodes] input change
      observeOn(asyncScheduler)
    );
  }
  static {
    this.ɵfac = function EdgeChangesService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _EdgeChangesService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _EdgeChangesService,
      factory: _EdgeChangesService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(EdgeChangesService, [{
    type: Injectable
  }], null, null);
})();
var ChangesControllerDirective = class _ChangesControllerDirective {
  constructor() {
    this.nodesChangeService = inject(NodesChangeService);
    this.edgesChangeService = inject(EdgeChangesService);
    this.onNodesChange = outputFromObservable(this.nodesChangeService.changes$);
    this.onNodesChangePosition = outputFromObservable(this.nodeChangesOfType("position"), {
      alias: "onNodesChange.position"
    });
    this.onNodesChangePositionSignle = outputFromObservable(this.singleChange(this.nodeChangesOfType("position")), {
      alias: "onNodesChange.position.single"
    });
    this.onNodesChangePositionMany = outputFromObservable(this.manyChanges(this.nodeChangesOfType("position")), {
      alias: "onNodesChange.position.many"
    });
    this.onNodesChangeSize = outputFromObservable(this.nodeChangesOfType("size"), {
      alias: "onNodesChange.size"
    });
    this.onNodesChangeSizeSingle = outputFromObservable(this.singleChange(this.nodeChangesOfType("size")), {
      alias: "onNodesChange.size.single"
    });
    this.onNodesChangeSizeMany = outputFromObservable(this.manyChanges(this.nodeChangesOfType("size")), {
      alias: "onNodesChange.size.many"
    });
    this.onNodesChangeAdd = outputFromObservable(this.nodeChangesOfType("add"), {
      alias: "onNodesChange.add"
    });
    this.onNodesChangeAddSingle = outputFromObservable(this.singleChange(this.nodeChangesOfType("add")), {
      alias: "onNodesChange.add.single"
    });
    this.onNodesChangeAddMany = outputFromObservable(this.manyChanges(this.nodeChangesOfType("add")), {
      alias: "onNodesChange.add.many"
    });
    this.onNodesChangeRemove = outputFromObservable(this.nodeChangesOfType("remove"), {
      alias: "onNodesChange.remove"
    });
    this.onNodesChangeRemoveSingle = outputFromObservable(this.singleChange(this.nodeChangesOfType("remove")), {
      alias: "onNodesChange.remove.single"
    });
    this.onNodesChangeRemoveMany = outputFromObservable(this.manyChanges(this.nodeChangesOfType("remove")), {
      alias: "onNodesChange.remove.many"
    });
    this.onNodesChangeSelect = outputFromObservable(this.nodeChangesOfType("select"), {
      alias: "onNodesChange.select"
    });
    this.onNodesChangeSelectSingle = outputFromObservable(this.singleChange(this.nodeChangesOfType("select")), {
      alias: "onNodesChange.select.single"
    });
    this.onNodesChangeSelectMany = outputFromObservable(this.manyChanges(this.nodeChangesOfType("select")), {
      alias: "onNodesChange.select.many"
    });
    this.onEdgesChange = outputFromObservable(this.edgesChangeService.changes$);
    this.onNodesChangeDetached = outputFromObservable(this.edgeChangesOfType("detached"), {
      alias: "onEdgesChange.detached"
    });
    this.onNodesChangeDetachedSingle = outputFromObservable(this.singleChange(this.edgeChangesOfType("detached")), {
      alias: "onEdgesChange.detached.single"
    });
    this.onNodesChangeDetachedMany = outputFromObservable(this.manyChanges(this.edgeChangesOfType("detached")), {
      alias: "onEdgesChange.detached.many"
    });
    this.onEdgesChangeAdd = outputFromObservable(this.edgeChangesOfType("add"), {
      alias: "onEdgesChange.add"
    });
    this.onEdgeChangeAddSingle = outputFromObservable(this.singleChange(this.edgeChangesOfType("add")), {
      alias: "onEdgesChange.add.single"
    });
    this.onEdgeChangeAddMany = outputFromObservable(this.manyChanges(this.edgeChangesOfType("add")), {
      alias: "onEdgesChange.add.many"
    });
    this.onEdgeChangeRemove = outputFromObservable(this.edgeChangesOfType("remove"), {
      alias: "onEdgesChange.remove"
    });
    this.onEdgeChangeRemoveSingle = outputFromObservable(this.singleChange(this.edgeChangesOfType("remove")), {
      alias: "onEdgesChange.remove.single"
    });
    this.onEdgeChangeRemoveMany = outputFromObservable(this.manyChanges(this.edgeChangesOfType("remove")), {
      alias: "onEdgesChange.remove.many"
    });
    this.onEdgeChangeSelect = outputFromObservable(this.edgeChangesOfType("select"), {
      alias: "onEdgesChange.select"
    });
    this.onEdgeChangeSelectSingle = outputFromObservable(this.singleChange(this.edgeChangesOfType("select")), {
      alias: "onEdgesChange.select.single"
    });
    this.onEdgeChangeSelectMany = outputFromObservable(this.manyChanges(this.edgeChangesOfType("select")), {
      alias: "onEdgesChange.select.many"
    });
  }
  nodeChangesOfType(type) {
    return this.nodesChangeService.changes$.pipe(map((changes) => changes.filter((c) => c.type === type)), filter((changes) => !!changes.length));
  }
  edgeChangesOfType(type) {
    return this.edgesChangeService.changes$.pipe(map((changes) => changes.filter((c) => c.type === type)), filter((changes) => !!changes.length));
  }
  singleChange(changes$) {
    return changes$.pipe(filter((changes) => changes.length === 1), map(([first]) => first));
  }
  manyChanges(changes$) {
    return changes$.pipe(filter((changes) => changes.length > 1));
  }
  static {
    this.ɵfac = function ChangesControllerDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _ChangesControllerDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _ChangesControllerDirective,
      selectors: [["", "changesController", ""]],
      outputs: {
        onNodesChange: "onNodesChange",
        onNodesChangePosition: "onNodesChange.position",
        onNodesChangePositionSignle: "onNodesChange.position.single",
        onNodesChangePositionMany: "onNodesChange.position.many",
        onNodesChangeSize: "onNodesChange.size",
        onNodesChangeSizeSingle: "onNodesChange.size.single",
        onNodesChangeSizeMany: "onNodesChange.size.many",
        onNodesChangeAdd: "onNodesChange.add",
        onNodesChangeAddSingle: "onNodesChange.add.single",
        onNodesChangeAddMany: "onNodesChange.add.many",
        onNodesChangeRemove: "onNodesChange.remove",
        onNodesChangeRemoveSingle: "onNodesChange.remove.single",
        onNodesChangeRemoveMany: "onNodesChange.remove.many",
        onNodesChangeSelect: "onNodesChange.select",
        onNodesChangeSelectSingle: "onNodesChange.select.single",
        onNodesChangeSelectMany: "onNodesChange.select.many",
        onEdgesChange: "onEdgesChange",
        onNodesChangeDetached: "onEdgesChange.detached",
        onNodesChangeDetachedSingle: "onEdgesChange.detached.single",
        onNodesChangeDetachedMany: "onEdgesChange.detached.many",
        onEdgesChangeAdd: "onEdgesChange.add",
        onEdgeChangeAddSingle: "onEdgesChange.add.single",
        onEdgeChangeAddMany: "onEdgesChange.add.many",
        onEdgeChangeRemove: "onEdgesChange.remove",
        onEdgeChangeRemoveSingle: "onEdgesChange.remove.single",
        onEdgeChangeRemoveMany: "onEdgesChange.remove.many",
        onEdgeChangeSelect: "onEdgesChange.select",
        onEdgeChangeSelectSingle: "onEdgesChange.select.single",
        onEdgeChangeSelectMany: "onEdgesChange.select.many"
      }
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ChangesControllerDirective, [{
    type: Directive,
    args: [{
      selector: "[changesController]",
      standalone: true
    }]
  }], null, null);
})();
var RootPointerDirective = class _RootPointerDirective {
  constructor() {
    this.host = inject(ElementRef).nativeElement;
    this.initialTouch$ = new Subject();
    this.prevTouchEvent = null;
    this.mouseMovement$ = fromEvent(this.host, "mousemove").pipe(map((event) => ({
      x: event.clientX,
      y: event.clientY,
      movementX: event.movementX,
      movementY: event.movementY,
      target: event.target,
      originalEvent: event
    })), observeOn(animationFrameScheduler), share());
    this.touchMovement$ = merge(this.initialTouch$, fromEvent(this.host, "touchmove")).pipe(tap((event) => event.preventDefault()), map((originalEvent) => {
      const x = originalEvent.touches[0]?.clientX ?? 0;
      const y = originalEvent.touches[0]?.clientY ?? 0;
      const movementX = this.prevTouchEvent ? originalEvent.touches[0].pageX - this.prevTouchEvent.touches[0].pageX : 0;
      const movementY = this.prevTouchEvent ? originalEvent.touches[0].pageY - this.prevTouchEvent.touches[0].pageY : 0;
      const target = document.elementFromPoint(x, y);
      return {
        x,
        y,
        movementX,
        movementY,
        target,
        originalEvent
      };
    }), tap((event) => this.prevTouchEvent = event.originalEvent), observeOn(animationFrameScheduler), share());
    this.pointerMovement$ = merge(this.mouseMovement$, this.touchMovement$);
    this.touchEnd$ = fromEvent(this.host, "touchend").pipe(map((originalEvent) => {
      const x = originalEvent.changedTouches[0]?.clientX ?? 0;
      const y = originalEvent.changedTouches[0]?.clientY ?? 0;
      const target = document.elementFromPoint(x, y);
      return {
        x,
        y,
        target,
        originalEvent
      };
    }), tap(() => this.prevTouchEvent = null), share());
    this.mouseUp$ = fromEvent(this.host, "mouseup").pipe(map((originalEvent) => {
      const x = originalEvent.clientX;
      const y = originalEvent.clientY;
      const target = originalEvent.target;
      return {
        x,
        y,
        target,
        originalEvent
      };
    }), share());
    this.documentPointerEnd$ = merge(fromEvent(document, "mouseup"), fromEvent(document, "touchend")).pipe(share());
  }
  /**
   * We should know when user started a touch in order to not
   * show old touch position when connection creation is started
   */
  setInitialTouch(event) {
    this.initialTouch$.next(event);
  }
  static {
    this.ɵfac = function RootPointerDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _RootPointerDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _RootPointerDirective,
      selectors: [["svg", "rootPointer", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(RootPointerDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "svg[rootPointer]"
    }]
  }], null, null);
})();
var SpacePointContextDirective = class _SpacePointContextDirective {
  constructor() {
    this.pointerMovementDirective = inject(RootPointerDirective);
    this.rootSvg = inject(RootSvgReferenceDirective).element;
    this.host = inject(ElementRef).nativeElement;
    this.svgCurrentSpacePoint = computed(() => {
      const movement = this.pointerMovement();
      if (!movement) {
        return {
          x: 0,
          y: 0
        };
      }
      return this.documentPointToFlowPoint({
        x: movement.x,
        y: movement.y
      });
    });
    this.pointerMovement = toSignal(this.pointerMovementDirective.pointerMovement$);
  }
  documentPointToFlowPoint(documentPoint) {
    const point = this.rootSvg.createSVGPoint();
    point.x = documentPoint.x;
    point.y = documentPoint.y;
    return point.matrixTransform(this.host.getScreenCTM().inverse());
  }
  static {
    this.ɵfac = function SpacePointContextDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _SpacePointContextDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _SpacePointContextDirective,
      selectors: [["g", "spacePointContext", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(SpacePointContextDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "g[spacePointContext]"
    }]
  }], null, null);
})();
function transformBackground(background) {
  return typeof background === "string" ? {
    type: "solid",
    color: background
  } : background;
}
function Microtask(target, key, descriptor) {
  const originalMethod = descriptor.value;
  descriptor.value = function(...args) {
    queueMicrotask(() => {
      originalMethod?.apply(this, args);
    });
  };
  return descriptor;
}
var OverlaysService = class _OverlaysService {
  constructor() {
    this.toolbars = signal([]);
    this.nodeToolbarsMap = computed(() => {
      const map2 = /* @__PURE__ */ new Map();
      this.toolbars().forEach((toolbar) => {
        const existing = map2.get(toolbar.node) ?? [];
        map2.set(toolbar.node, [...existing, toolbar]);
      });
      return map2;
    });
  }
  addToolbar(toolbar) {
    this.toolbars.update((toolbars) => [...toolbars, toolbar]);
  }
  removeToolbar(toolbar) {
    this.toolbars.update((toolbars) => toolbars.filter((t) => t !== toolbar));
  }
  static {
    this.ɵfac = function OverlaysService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _OverlaysService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _OverlaysService,
      factory: _OverlaysService.ɵfac
    });
  }
};
__decorate([Microtask], OverlaysService.prototype, "addToolbar", null);
__decorate([Microtask], OverlaysService.prototype, "removeToolbar", null);
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(OverlaysService, [{
    type: Injectable
  }], null, {
    addToolbar: [],
    removeToolbar: []
  });
})();
function resizable(elems, zone) {
  return new Observable((subscriber) => {
    const ro = new ResizeObserver((entries) => {
      zone.run(() => subscriber.next(entries));
    });
    elems.forEach((e) => ro.observe(e));
    return () => ro.disconnect();
  });
}
var EdgeLabelComponent = class _EdgeLabelComponent {
  constructor() {
    this.zone = inject(NgZone);
    this.destroyRef = inject(DestroyRef);
    this.settingsService = inject(FlowSettingsService);
    this.model = input.required();
    this.edgeModel = input.required();
    this.point = input({
      x: 0,
      y: 0
    });
    this.htmlTemplate = input();
    this.edgeLabelWrapperRef = viewChild.required("edgeLabelWrapper");
    this.edgeLabelPoint = computed(() => {
      const point = this.point();
      const {
        width,
        height
      } = this.model().size();
      return {
        x: point.x - width / 2,
        y: point.y - height / 2
      };
    });
    this.edgeLabelStyle = computed(() => {
      const label = this.model().edgeLabel;
      if (label.type === "default" && label.style) {
        const flowBackground = this.settingsService.background();
        let color2 = "transparent";
        if (flowBackground.type === "dots") {
          color2 = flowBackground.backgroundColor ?? "#fff";
        }
        if (flowBackground.type === "solid") {
          color2 = flowBackground.color;
        }
        label.style.backgroundColor = label.style.backgroundColor ?? color2;
        return label.style;
      }
      return null;
    });
  }
  ngAfterViewInit() {
    const labelElement = this.edgeLabelWrapperRef().nativeElement;
    resizable([labelElement], this.zone).pipe(startWith(null), tap(() => {
      const width = labelElement.clientWidth + MAGIC_NUMBER_TO_FIX_GLITCH_IN_CHROME;
      const height = labelElement.clientHeight + MAGIC_NUMBER_TO_FIX_GLITCH_IN_CHROME;
      this.model().size.set({
        width,
        height
      });
    }), takeUntilDestroyed(this.destroyRef)).subscribe();
  }
  // TODO: move to model with Contextable interface
  getLabelContext() {
    return {
      $implicit: {
        edge: this.edgeModel().edge,
        label: this.model().edgeLabel
      }
    };
  }
  static {
    this.ɵfac = function EdgeLabelComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _EdgeLabelComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _EdgeLabelComponent,
      selectors: [["g", "edgeLabel", ""]],
      viewQuery: function EdgeLabelComponent_Query(rf, ctx) {
        if (rf & 1) {
          ɵɵviewQuerySignal(ctx.edgeLabelWrapperRef, _c0, 5);
        }
        if (rf & 2) {
          ɵɵqueryAdvance();
        }
      },
      inputs: {
        model: [1, "model"],
        edgeModel: [1, "edgeModel"],
        point: [1, "point"],
        htmlTemplate: [1, "htmlTemplate"]
      },
      attrs: _c1,
      decls: 1,
      vars: 1,
      consts: [["edgeLabelWrapper", ""], [1, "edge-label-wrapper"], [4, "ngTemplateOutlet", "ngTemplateOutletContext"]],
      template: function EdgeLabelComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵconditionalCreate(0, EdgeLabelComponent_Conditional_0_Template, 2, 2);
        }
        if (rf & 2) {
          let tmp_0_0;
          ɵɵconditional((tmp_0_0 = ctx.model()) ? 0 : -1, tmp_0_0);
        }
      },
      dependencies: [NgTemplateOutlet],
      styles: [".edge-label-wrapper[_ngcontent-%COMP%]{width:max-content;margin-top:1px;margin-left:1px}"],
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(EdgeLabelComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "g[edgeLabel]",
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NgTemplateOutlet],
      template: `@if (model(); as model) {
  @if (model.edgeLabel.type === 'html-template' && htmlTemplate()) {
    @if (htmlTemplate(); as htmlTemplate) {
      <svg:foreignObject
        [attr.x]="edgeLabelPoint().x"
        [attr.y]="edgeLabelPoint().y"
        [attr.width]="model.size().width"
        [attr.height]="model.size().height">
        <div #edgeLabelWrapper class="edge-label-wrapper">
          <ng-container *ngTemplateOutlet="htmlTemplate; context: getLabelContext()" />
        </div>
      </svg:foreignObject>
    }
  }

  @if (model.edgeLabel.type === 'default') {
    <svg:foreignObject
      [attr.x]="edgeLabelPoint().x"
      [attr.y]="edgeLabelPoint().y"
      [attr.width]="model.size().width"
      [attr.height]="model.size().height">
      <div #edgeLabelWrapper class="edge-label-wrapper" [style]="edgeLabelStyle()">
        {{ model.edgeLabel.text }}
      </div>
    </svg:foreignObject>
  }
}
`,
      styles: [".edge-label-wrapper{width:max-content;margin-top:1px;margin-left:1px}\n"]
    }]
  }], null, null);
})();
function adjustDirection(connection) {
  const result = {};
  if (connection.sourceHandle.rawHandle.type === "source") {
    result.source = connection.source;
    result.sourceHandle = connection.sourceHandle;
  } else {
    result.source = connection.target;
    result.sourceHandle = connection.targetHandle;
  }
  if (connection.targetHandle.rawHandle.type === "target") {
    result.target = connection.target;
    result.targetHandle = connection.targetHandle;
  } else {
    result.target = connection.source;
    result.targetHandle = connection.sourceHandle;
  }
  return result;
}
var ConnectionControllerDirective = class _ConnectionControllerDirective {
  constructor() {
    this.statusService = inject(FlowStatusService);
    this.flowEntitiesService = inject(FlowEntitiesService);
    this.onConnect = outputFromObservable(toObservable(this.statusService.status).pipe(filter((status) => status.state === "connection-end"), map((status) => statusToConnection(status, this.isStrictMode())), tap(() => this.statusService.setIdleStatus()), filter((connection) => this.flowEntitiesService.connection().validator(connection))));
    this.connect = outputFromObservable(toObservable(this.statusService.status).pipe(filter((status) => status.state === "connection-end"), map((status) => statusToConnection(status, this.isStrictMode())), tap(() => this.statusService.setIdleStatus()), filter((connection) => this.flowEntitiesService.connection().validator(connection))));
    this.onReconnect = outputFromObservable(toObservable(this.statusService.status).pipe(filter((status) => status.state === "reconnection-end"), map((status) => {
      const connection = statusToConnection(status, this.isStrictMode());
      const oldEdge = status.payload.oldEdge.edge;
      return {
        connection,
        oldEdge
      };
    }), tap(() => this.statusService.setIdleStatus()), filter(({
      connection
    }) => this.flowEntitiesService.connection().validator(connection))));
    this.reconnect = outputFromObservable(toObservable(this.statusService.status).pipe(filter((status) => status.state === "reconnection-end"), map((status) => {
      const connection = statusToConnection(status, this.isStrictMode());
      const oldEdge = status.payload.oldEdge.edge;
      return {
        connection,
        oldEdge
      };
    }), tap(() => this.statusService.setIdleStatus()), filter(({
      connection
    }) => this.flowEntitiesService.connection().validator(connection))));
    this.isStrictMode = computed(() => this.flowEntitiesService.connection().mode === "strict");
  }
  startConnection(handle) {
    this.statusService.setConnectionStartStatus(handle.parentNode, handle);
  }
  startReconnection(handle, oldEdge) {
    this.statusService.setReconnectionStartStatus(handle.parentNode, handle, oldEdge);
  }
  validateConnection(handle) {
    const status = this.statusService.status();
    if (status.state === "connection-start" || status.state === "reconnection-start") {
      const isReconnection = status.state === "reconnection-start";
      let source = status.payload.source;
      let target = handle.parentNode;
      let sourceHandle = status.payload.sourceHandle;
      let targetHandle = handle;
      if (this.isStrictMode()) {
        const adjusted = adjustDirection({
          source: status.payload.source,
          sourceHandle: status.payload.sourceHandle,
          target: handle.parentNode,
          targetHandle: handle
        });
        source = adjusted.source;
        target = adjusted.target;
        sourceHandle = adjusted.sourceHandle;
        targetHandle = adjusted.targetHandle;
      }
      const valid = this.flowEntitiesService.connection().validator({
        source: source.rawNode.id,
        target: target.rawNode.id,
        sourceHandle: sourceHandle.rawHandle.id,
        targetHandle: targetHandle.rawHandle.id
      });
      handle.state.set(valid ? "valid" : "invalid");
      isReconnection ? this.statusService.setReconnectionValidationStatus(valid, status.payload.source, handle.parentNode, status.payload.sourceHandle, handle, status.payload.oldEdge) : this.statusService.setConnectionValidationStatus(valid, status.payload.source, handle.parentNode, status.payload.sourceHandle, handle);
    }
  }
  resetValidateConnection(targetHandle) {
    targetHandle.state.set("idle");
    const status = this.statusService.status();
    if (status.state === "connection-validation" || status.state === "reconnection-validation") {
      const isReconnection = status.state === "reconnection-validation";
      isReconnection ? this.statusService.setReconnectionStartStatus(status.payload.source, status.payload.sourceHandle, status.payload.oldEdge) : this.statusService.setConnectionStartStatus(status.payload.source, status.payload.sourceHandle);
    }
  }
  endConnection() {
    const status = this.statusService.status();
    if (status.state === "connection-validation" || status.state === "reconnection-validation") {
      const isReconnection = status.state === "reconnection-validation";
      const source = status.payload.source;
      const sourceHandle = status.payload.sourceHandle;
      const target = status.payload.target;
      const targetHandle = status.payload.targetHandle;
      isReconnection ? this.statusService.setReconnectionEndStatus(source, target, sourceHandle, targetHandle, status.payload.oldEdge) : this.statusService.setConnectionEndStatus(source, target, sourceHandle, targetHandle);
    }
  }
  static {
    this.ɵfac = function ConnectionControllerDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _ConnectionControllerDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _ConnectionControllerDirective,
      selectors: [["", "onConnect", ""], ["", "onReconnect", ""], ["", "connect", ""], ["", "reconnect", ""]],
      outputs: {
        onConnect: "onConnect",
        connect: "connect",
        onReconnect: "onReconnect",
        reconnect: "reconnect"
      }
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ConnectionControllerDirective, [{
    type: Directive,
    args: [{
      selector: "[onConnect], [onReconnect], [connect], [reconnect]",
      standalone: true
    }]
  }], null, null);
})();
function statusToConnection(status, isStrictMode) {
  let source = status.payload.source;
  let target = status.payload.target;
  let sourceHandle = status.payload.sourceHandle;
  let targetHandle = status.payload.targetHandle;
  if (isStrictMode) {
    const adjusted = adjustDirection({
      source: status.payload.source,
      sourceHandle: status.payload.sourceHandle,
      target: status.payload.target,
      targetHandle: status.payload.targetHandle
    });
    source = adjusted.source;
    target = adjusted.target;
    sourceHandle = adjusted.sourceHandle;
    targetHandle = adjusted.targetHandle;
  }
  const sourceId = source.rawNode.id;
  const targetId = target.rawNode.id;
  const sourceHandleId = sourceHandle.rawHandle.id;
  const targetHandleId = targetHandle.rawHandle.id;
  return {
    source: sourceId,
    target: targetId,
    sourceHandle: sourceHandleId,
    targetHandle: targetHandleId
  };
}
var EdgeRenderingService = class _EdgeRenderingService {
  constructor() {
    this.flowEntitiesService = inject(FlowEntitiesService);
    this.flowSettingsService = inject(FlowSettingsService);
    this.edges = computed(() => {
      if (!this.flowSettingsService.optimization().virtualization) {
        return [...this.flowEntitiesService.validEdges()].sort((aEdge, bEdge) => aEdge.renderOrder() - bEdge.renderOrder());
      }
      return this.viewportEdges().sort((aEdge, bEdge) => aEdge.renderOrder() - bEdge.renderOrder());
    });
    this.viewportEdges = computed(() => {
      return this.flowEntitiesService.validEdges().filter((e) => {
        const sourceHandle = e.sourceHandle();
        const targetHandle = e.targetHandle();
        return sourceHandle && targetHandle;
      });
    });
    this.maxOrder = computed(() => {
      return Math.max(...this.flowEntitiesService.validEdges().map((n) => n.renderOrder()));
    });
  }
  pull(edge) {
    const isAlreadyOnTop = edge.renderOrder() !== 0 && this.maxOrder() === edge.renderOrder();
    if (isAlreadyOnTop) {
      return;
    }
    edge.renderOrder.set(this.maxOrder() + 1);
  }
  static {
    this.ɵfac = function EdgeRenderingService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _EdgeRenderingService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _EdgeRenderingService,
      factory: _EdgeRenderingService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(EdgeRenderingService, [{
    type: Injectable
  }], null, null);
})();
function isTouchEvent(event) {
  return window.TouchEvent && event instanceof TouchEvent;
}
var PointerDirective = class _PointerDirective {
  constructor() {
    this.hostElement = inject(ElementRef).nativeElement;
    this.pointerMovementDirective = inject(RootPointerDirective);
    this.pointerOver = output();
    this.pointerOut = output();
    this.pointerStart = output();
    this.pointerEnd = output();
    this.wasPointerOver = false;
    this.touchEnd = this.pointerMovementDirective.touchEnd$.pipe(filter(({
      target
    }) => target === this.hostElement), tap(({
      originalEvent
    }) => this.pointerEnd.emit(originalEvent)), takeUntilDestroyed()).subscribe();
    this.touchOverOut = this.pointerMovementDirective.touchMovement$.pipe(tap(({
      target,
      originalEvent
    }) => {
      this.handleTouchOverAndOut(target, originalEvent);
    }), takeUntilDestroyed()).subscribe();
  }
  onPointerStart(event) {
    this.pointerStart.emit(event);
    if (isTouchEvent(event)) {
      this.pointerMovementDirective.setInitialTouch(event);
    }
  }
  onPointerEnd(event) {
    this.pointerEnd.emit(event);
  }
  onMouseOver(event) {
    this.pointerOver.emit(event);
  }
  onMouseOut(event) {
    this.pointerOut.emit(event);
  }
  // TODO: dirty imperative implementation
  handleTouchOverAndOut(target, event) {
    if (target === this.hostElement) {
      this.pointerOver.emit(event);
      this.wasPointerOver = true;
    } else {
      if (this.wasPointerOver) {
        this.pointerOut.emit(event);
      }
      this.wasPointerOver = false;
    }
  }
  static {
    this.ɵfac = function PointerDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _PointerDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _PointerDirective,
      selectors: [["", "pointerStart", ""], ["", "pointerEnd", ""], ["", "pointerOver", ""], ["", "pointerOut", ""]],
      hostBindings: function PointerDirective_HostBindings(rf, ctx) {
        if (rf & 1) {
          ɵɵlistener("mousedown", function PointerDirective_mousedown_HostBindingHandler($event) {
            return ctx.onPointerStart($event);
          })("touchstart", function PointerDirective_touchstart_HostBindingHandler($event) {
            return ctx.onPointerStart($event);
          })("mouseup", function PointerDirective_mouseup_HostBindingHandler($event) {
            return ctx.onPointerEnd($event);
          })("mouseover", function PointerDirective_mouseover_HostBindingHandler($event) {
            return ctx.onMouseOver($event);
          })("mouseout", function PointerDirective_mouseout_HostBindingHandler($event) {
            return ctx.onMouseOut($event);
          });
        }
      },
      outputs: {
        pointerOver: "pointerOver",
        pointerOut: "pointerOut",
        pointerStart: "pointerStart",
        pointerEnd: "pointerEnd"
      }
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(PointerDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "[pointerStart], [pointerEnd], [pointerOver], [pointerOut]"
    }]
  }], null, {
    onPointerStart: [{
      type: HostListener,
      args: ["mousedown", ["$event"]]
    }, {
      type: HostListener,
      args: ["touchstart", ["$event"]]
    }],
    onPointerEnd: [{
      type: HostListener,
      args: ["mouseup", ["$event"]]
    }],
    onMouseOver: [{
      type: HostListener,
      args: ["mouseover", ["$event"]]
    }],
    onMouseOut: [{
      type: HostListener,
      args: ["mouseout", ["$event"]]
    }]
  });
})();
var EdgeComponent = class _EdgeComponent {
  constructor() {
    this.injector = inject(Injector);
    this.selectionService = inject(SelectionService);
    this.flowSettingsService = inject(FlowSettingsService);
    this.flowStatusService = inject(FlowStatusService);
    this.edgeRenderingService = inject(EdgeRenderingService);
    this.connectionController = inject(ConnectionControllerDirective, {
      optional: true
    });
    this.model = input.required();
    this.edgeTemplate = input();
    this.edgeLabelHtmlTemplate = input();
    this.isReconnecting = computed(() => {
      const status = this.flowStatusService.status();
      const isReconnecting = status.state === "reconnection-start" || status.state === "reconnection-validation";
      return isReconnecting && status.payload.oldEdge === this.model();
    });
  }
  select() {
    if (this.flowSettingsService.entitiesSelectable()) {
      this.selectionService.select(this.model());
    }
  }
  pull() {
    if (this.flowSettingsService.elevateEdgesOnSelect()) {
      this.edgeRenderingService.pull(this.model());
    }
  }
  startReconnection(event, handle) {
    event.stopPropagation();
    this.connectionController?.startReconnection(handle, this.model());
  }
  static {
    this.ɵfac = function EdgeComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _EdgeComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _EdgeComponent,
      selectors: [["g", "edge", ""]],
      hostAttrs: [1, "selectable"],
      hostVars: 2,
      hostBindings: function EdgeComponent_HostBindings(rf, ctx) {
        if (rf & 2) {
          ɵɵstyleProp("visibility", ctx.isReconnecting() ? "hidden" : "visible");
        }
      },
      inputs: {
        model: [1, "model"],
        edgeTemplate: [1, "edgeTemplate"],
        edgeLabelHtmlTemplate: [1, "edgeLabelHtmlTemplate"]
      },
      attrs: _c2,
      decls: 6,
      vars: 6,
      consts: [[1, "edge"], [1, "interactive-edge", 3, "click"], [3, "ngTemplateOutlet", "ngTemplateOutletContext", "ngTemplateOutletInjector"], ["edgeLabel", "", 3, "model", "point", "edgeModel", "htmlTemplate"], ["r", "10", 1, "reconnect-handle"], ["r", "10", 1, "reconnect-handle", 3, "pointerStart"]],
      template: function EdgeComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵconditionalCreate(0, EdgeComponent_Conditional_0_Template, 2, 6);
          ɵɵconditionalCreate(1, EdgeComponent_Conditional_1_Template, 1, 1);
          ɵɵconditionalCreate(2, EdgeComponent_Conditional_2_Template, 1, 1);
          ɵɵconditionalCreate(3, EdgeComponent_Conditional_3_Template, 1, 1);
          ɵɵconditionalCreate(4, EdgeComponent_Conditional_4_Template, 1, 1);
          ɵɵconditionalCreate(5, EdgeComponent_Conditional_5_Template, 2, 2);
        }
        if (rf & 2) {
          let tmp_2_0;
          let tmp_3_0;
          let tmp_4_0;
          ɵɵconditional(ctx.model().type === "default" ? 0 : -1);
          ɵɵadvance();
          ɵɵconditional(ctx.model().type === "template" && ctx.edgeTemplate() ? 1 : -1);
          ɵɵadvance();
          ɵɵconditional((tmp_2_0 = ctx.model().edgeLabels.start) ? 2 : -1, tmp_2_0);
          ɵɵadvance();
          ɵɵconditional((tmp_3_0 = ctx.model().edgeLabels.center) ? 3 : -1, tmp_3_0);
          ɵɵadvance();
          ɵɵconditional((tmp_4_0 = ctx.model().edgeLabels.end) ? 4 : -1, tmp_4_0);
          ɵɵadvance();
          ɵɵconditional(ctx.model().sourceHandle() && ctx.model().targetHandle() ? 5 : -1);
        }
      },
      dependencies: [NgTemplateOutlet, EdgeLabelComponent, PointerDirective],
      styles: [".edge[_ngcontent-%COMP%]{fill:none;stroke-width:2;stroke:#b1b1b7}.edge_selected[_ngcontent-%COMP%]{stroke-width:2.5;stroke:#0f4c75}.interactive-edge[_ngcontent-%COMP%]{fill:none;stroke-width:20;stroke:transparent}.reconnect-handle[_ngcontent-%COMP%]{fill:transparent;cursor:move}"],
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(EdgeComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "g[edge]",
      changeDetection: ChangeDetectionStrategy.OnPush,
      host: {
        class: "selectable",
        "[style.visibility]": 'isReconnecting() ? "hidden" : "visible"'
      },
      imports: [NgTemplateOutlet, EdgeLabelComponent, PointerDirective],
      template: `@if (model().type === 'default') {
  <svg:path
    class="edge"
    [attr.d]="model().path().path"
    [attr.marker-start]="model().markerStartUrl()"
    [attr.marker-end]="model().markerEndUrl()"
    [class.edge_selected]="model().selected()" />

  <svg:path class="interactive-edge" [attr.d]="model().path().path" (click)="select(); pull()" />
}

@if (model().type === 'template' && edgeTemplate()) {
  @if (edgeTemplate(); as edgeTemplate) {
    <ng-container
      [ngTemplateOutlet]="edgeTemplate"
      [ngTemplateOutletContext]="model().context"
      [ngTemplateOutletInjector]="injector" />
  }
}

@if (model().edgeLabels.start; as label) {
  @if (model().path().labelPoints?.start; as point) {
    <svg:g edgeLabel [model]="label" [point]="point" [edgeModel]="model()" [htmlTemplate]="edgeLabelHtmlTemplate()" />
  }
}

@if (model().edgeLabels.center; as label) {
  @if (model().path().labelPoints?.center; as point) {
    <svg:g edgeLabel [model]="label" [point]="point" [edgeModel]="model()" [htmlTemplate]="edgeLabelHtmlTemplate()" />
  }
}

@if (model().edgeLabels.end; as label) {
  @if (model().path().labelPoints?.end; as point) {
    <svg:g edgeLabel [model]="label" [point]="point" [edgeModel]="model()" [htmlTemplate]="edgeLabelHtmlTemplate()" />
  }
}

@if (model().sourceHandle() && model().targetHandle()) {
  @if (model().reconnectable === true || model().reconnectable === 'source') {
    <svg:circle
      class="reconnect-handle"
      r="10"
      [attr.cx]="model().sourceHandle()!.pointAbsolute().x"
      [attr.cy]="model().sourceHandle()!.pointAbsolute().y"
      (pointerStart)="startReconnection($event, model().targetHandle()!)" />
  }

  @if (model().reconnectable === true || model().reconnectable === 'target') {
    <svg:circle
      class="reconnect-handle"
      r="10"
      [attr.cx]="model().targetHandle()!.pointAbsolute().x"
      [attr.cy]="model().targetHandle()!.pointAbsolute().y"
      (pointerStart)="startReconnection($event, model().sourceHandle()!)" />
  }
}
`,
      styles: [".edge{fill:none;stroke-width:2;stroke:#b1b1b7}.edge_selected{stroke-width:2.5;stroke:#0f4c75}.interactive-edge{fill:none;stroke-width:20;stroke:transparent}.reconnect-handle{fill:transparent;cursor:move}\n"]
    }]
  }], null, null);
})();
var HandleService = class _HandleService {
  constructor() {
    this.node = signal(null);
  }
  createHandle(newHandle) {
    const node = this.node();
    if (node) {
      node.handles.update((handles) => [...handles, newHandle]);
    }
  }
  destroyHandle(handleToDestoy) {
    const node = this.node();
    if (node) {
      node.handles.update((handles) => handles.filter((handle) => handle !== handleToDestoy));
    }
  }
  static {
    this.ɵfac = function HandleService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _HandleService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _HandleService,
      factory: _HandleService.ɵfac
    });
  }
};
__decorate([
  Microtask
  // TODO fixes rendering of handle for group node
], HandleService.prototype, "createHandle", null);
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(HandleService, [{
    type: Injectable
  }], null, {
    createHandle: []
  });
})();
var HandleSizeControllerDirective = class _HandleSizeControllerDirective {
  constructor() {
    this.handleModel = input.required({
      alias: "handleSizeController"
    });
    this.handleWrapper = inject(ElementRef);
  }
  ngAfterViewInit() {
    const element = this.handleWrapper.nativeElement;
    const rect = element.getBBox();
    const stroke = getChildStrokeWidth(element);
    this.handleModel().size.set({
      width: rect.width + stroke,
      height: rect.height + stroke
    });
  }
  static {
    this.ɵfac = function HandleSizeControllerDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _HandleSizeControllerDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _HandleSizeControllerDirective,
      selectors: [["", "handleSizeController", ""]],
      inputs: {
        handleModel: [1, "handleSizeController", "handleModel"]
      }
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(HandleSizeControllerDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "[handleSizeController]"
    }]
  }], null, null);
})();
function getChildStrokeWidth(element) {
  const child = element.firstElementChild;
  if (child) {
    const stroke = getComputedStyle(child).strokeWidth;
    const strokeAsNumber = Number(stroke.replace("px", ""));
    if (isNaN(strokeAsNumber)) {
      return 0;
    }
    return strokeAsNumber;
  }
  return 0;
}
var DefaultNodeComponent = class _DefaultNodeComponent {
  constructor() {
    this.selected = input(false);
  }
  static {
    this.ɵfac = function DefaultNodeComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _DefaultNodeComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _DefaultNodeComponent,
      selectors: [["default-node"]],
      hostVars: 2,
      hostBindings: function DefaultNodeComponent_HostBindings(rf, ctx) {
        if (rf & 2) {
          ɵɵclassProp("selected", ctx.selected());
        }
      },
      inputs: {
        selected: [1, "selected"]
      },
      ngContentSelectors: _c3,
      decls: 1,
      vars: 0,
      template: function DefaultNodeComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵprojectionDef();
          ɵɵprojection(0);
        }
      },
      styles: ["[_nghost-%COMP%]{border:1.5px solid #1b262c;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#000;background-color:#fff}.selected[_nghost-%COMP%]{border-width:2px}"],
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(DefaultNodeComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "default-node",
      host: {
        "[class.selected]": "selected()"
      },
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: "<ng-content />\n",
      styles: [":host{border:1.5px solid #1b262c;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#000;background-color:#fff}:host(.selected){border-width:2px}\n"]
    }]
  }], null, null);
})();
var ResizableComponent = class _ResizableComponent {
  get model() {
    return this.nodeAccessor.model();
  }
  constructor() {
    this.nodeAccessor = inject(NodeAccessorService);
    this.rootPointer = inject(RootPointerDirective);
    this.viewportService = inject(ViewportService);
    this.spacePointContext = inject(SpacePointContextDirective);
    this.settingsService = inject(FlowSettingsService);
    this.hostRef = inject(ElementRef);
    this.resizable = input();
    this.resizerColor = input("#2e414c");
    this.gap = input(1.5);
    this.resizer = viewChild.required("resizer");
    this.lineGap = 3;
    this.handleSize = 6;
    this.resizeSide = null;
    this.zoom = computed(() => this.viewportService.readableViewport().zoom ?? 0);
    this.minWidth = 0;
    this.minHeight = 0;
    this.maxWidth = Infinity;
    this.maxHeight = Infinity;
    this.resizeOnGlobalMouseMove = this.rootPointer.pointerMovement$.pipe(filter(() => this.resizeSide !== null), filter((event) => event.movementX !== 0 || event.movementY !== 0), tap((event) => this.resize(event)), takeUntilDestroyed()).subscribe();
    this.endResizeOnGlobalMouseUp = this.rootPointer.documentPointerEnd$.pipe(tap(() => this.endResize()), takeUntilDestroyed()).subscribe();
    effect(() => {
      const resizable2 = this.resizable();
      if (typeof resizable2 === "boolean") {
        this.model.resizable.set(resizable2);
      } else {
        this.model.resizable.set(true);
      }
    }, {
      allowSignalWrites: true
    });
  }
  ngOnInit() {
    this.model.controlledByResizer.set(true);
    this.model.resizerTemplate.set(this.resizer());
  }
  ngOnDestroy() {
    this.model.controlledByResizer.set(false);
  }
  ngAfterViewInit() {
    this.minWidth = +getComputedStyle(this.hostRef.nativeElement).minWidth.replace("px", "") || 0;
    this.minHeight = +getComputedStyle(this.hostRef.nativeElement).minHeight.replace("px", "") || 0;
    this.maxWidth = +getComputedStyle(this.hostRef.nativeElement).maxWidth.replace("px", "") || Infinity;
    this.maxHeight = +getComputedStyle(this.hostRef.nativeElement).maxHeight.replace("px", "") || Infinity;
  }
  startResize(side, event) {
    event.stopPropagation();
    this.resizeSide = side;
    this.model.resizing.set(true);
  }
  resize(event) {
    if (!this.resizeSide) return;
    const offset = calcOffset(event.movementX, event.movementY, this.zoom());
    const resized = this.applyResize(this.resizeSide, this.model, offset, this.getDistanceToEdge(event));
    const {
      x,
      y,
      width,
      height
    } = constrainRect(resized, this.model, this.resizeSide, this.minWidth, this.minHeight, this.maxWidth, this.maxHeight);
    this.model.setPoint({
      x,
      y
    });
    this.model.width.set(width);
    this.model.height.set(height);
  }
  endResize() {
    this.resizeSide = null;
    this.model.resizing.set(false);
  }
  getDistanceToEdge(event) {
    const flowPoint = this.spacePointContext.documentPointToFlowPoint({
      x: event.x,
      y: event.y
    });
    const {
      x,
      y
    } = this.model.globalPoint();
    return {
      left: flowPoint.x - x,
      right: flowPoint.x - (x + this.model.width()),
      top: flowPoint.y - y,
      bottom: flowPoint.y - (y + this.model.height())
    };
  }
  applyResize(side, model, offset, distanceToEdge) {
    const {
      x,
      y
    } = model.point();
    const width = model.width();
    const height = model.height();
    const [snapX, snapY] = this.settingsService.snapGrid();
    switch (side) {
      case "left": {
        const movementX = offset.x + distanceToEdge.left;
        const newX = align(x + movementX, snapX);
        const deltaX = newX - x;
        return {
          x: newX,
          y,
          width: width - deltaX,
          height
        };
      }
      case "right": {
        const movementX = offset.x + distanceToEdge.right;
        const newWidth = align(width + movementX, snapX);
        return {
          x,
          y,
          width: newWidth,
          height
        };
      }
      case "top": {
        const movementY = offset.y + distanceToEdge.top;
        const newY = align(y + movementY, snapY);
        const deltaY = newY - y;
        return {
          x,
          y: newY,
          width,
          height: height - deltaY
        };
      }
      case "bottom": {
        const movementY = offset.y + distanceToEdge.bottom;
        const newHeight = align(height + movementY, snapY);
        return {
          x,
          y,
          width,
          height: newHeight
        };
      }
      case "top-left": {
        const movementX = offset.x + distanceToEdge.left;
        const movementY = offset.y + distanceToEdge.top;
        const newX = align(x + movementX, snapX);
        const newY = align(y + movementY, snapY);
        const deltaX = newX - x;
        const deltaY = newY - y;
        return {
          x: newX,
          y: newY,
          width: width - deltaX,
          height: height - deltaY
        };
      }
      case "top-right": {
        const movementX = offset.x + distanceToEdge.right;
        const movementY = offset.y + distanceToEdge.top;
        const newY = align(y + movementY, snapY);
        const deltaY = newY - y;
        return {
          x,
          y: newY,
          width: align(width + movementX, snapX),
          height: height - deltaY
        };
      }
      case "bottom-left": {
        const movementX = offset.x + distanceToEdge.left;
        const movementY = offset.y + distanceToEdge.bottom;
        const newX = align(x + movementX, snapX);
        const deltaX = newX - x;
        return {
          x: newX,
          y,
          width: width - deltaX,
          height: align(height + movementY, snapY)
        };
      }
      case "bottom-right": {
        const movementX = offset.x + distanceToEdge.right;
        const movementY = offset.y + distanceToEdge.bottom;
        return {
          x,
          y,
          width: align(width + movementX, snapX),
          height: align(height + movementY, snapY)
        };
      }
    }
  }
  static {
    this.ɵfac = function ResizableComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _ResizableComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _ResizableComponent,
      selectors: [["", "resizable", ""]],
      viewQuery: function ResizableComponent_Query(rf, ctx) {
        if (rf & 1) {
          ɵɵviewQuerySignal(ctx.resizer, _c4, 5);
        }
        if (rf & 2) {
          ɵɵqueryAdvance();
        }
      },
      inputs: {
        resizable: [1, "resizable"],
        resizerColor: [1, "resizerColor"],
        gap: [1, "gap"]
      },
      attrs: _c5,
      ngContentSelectors: _c3,
      decls: 3,
      vars: 0,
      consts: [["resizer", ""], ["stroke-width", "2", 1, "top", 3, "pointerStart"], ["stroke-width", "2", 1, "left", 3, "pointerStart"], ["stroke-width", "2", 1, "bottom", 3, "pointerStart"], ["stroke-width", "2", 1, "right", 3, "pointerStart"], [1, "top-left", 3, "pointerStart"], [1, "top-right", 3, "pointerStart"], [1, "bottom-left", 3, "pointerStart"], [1, "bottom-right", 3, "pointerStart"]],
      template: function ResizableComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵprojectionDef();
          ɵɵtemplate(0, ResizableComponent_ng_template_0_Template, 9, 40, "ng-template", null, 0, ɵɵtemplateRefExtractor);
          ɵɵprojection(2);
        }
      },
      dependencies: [PointerDirective],
      styles: [".top[_ngcontent-%COMP%]{cursor:n-resize}.left[_ngcontent-%COMP%]{cursor:w-resize}.right[_ngcontent-%COMP%]{cursor:e-resize}.bottom[_ngcontent-%COMP%]{cursor:s-resize}.top-left[_ngcontent-%COMP%]{cursor:nw-resize}.top-right[_ngcontent-%COMP%]{cursor:ne-resize}.bottom-left[_ngcontent-%COMP%]{cursor:sw-resize}.bottom-right[_ngcontent-%COMP%]{cursor:se-resize}"],
      changeDetection: 0
    });
  }
};
__decorate([Microtask], ResizableComponent.prototype, "ngAfterViewInit", null);
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ResizableComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "[resizable]",
      imports: [PointerDirective],
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `<ng-template #resizer>
  <svg:g>
    <!-- top line -->
    <svg:line
      class="top"
      stroke-width="2"
      [attr.x1]="lineGap"
      [attr.y1]="-gap()"
      [attr.x2]="model.size().width - lineGap"
      [attr.y2]="-gap()"
      [attr.stroke]="resizerColor()"
      (pointerStart)="startResize('top', $event)" />
    <!-- Left line -->
    <svg:line
      class="left"
      stroke-width="2"
      [attr.x1]="-gap()"
      [attr.y1]="lineGap"
      [attr.x2]="-gap()"
      [attr.y2]="model.size().height - lineGap"
      [attr.stroke]="resizerColor()"
      (pointerStart)="startResize('left', $event)" />
    <!-- Bottom line -->
    <svg:line
      class="bottom"
      stroke-width="2"
      [attr.x1]="lineGap"
      [attr.y1]="model.size().height + gap()"
      [attr.x2]="model.size().width - lineGap"
      [attr.y2]="model.size().height + gap()"
      [attr.stroke]="resizerColor()"
      (pointerStart)="startResize('bottom', $event)" />
    <!-- Right line -->
    <svg:line
      class="right"
      stroke-width="2"
      [attr.x1]="model.size().width + gap()"
      [attr.y1]="lineGap"
      [attr.x2]="model.size().width + gap()"
      [attr.y2]="model.size().height - lineGap"
      [attr.stroke]="resizerColor()"
      (pointerStart)="startResize('right', $event)" />

    <!-- Top Left -->
    <svg:rect
      class="top-left"
      [attr.x]="-(handleSize / 2) - gap()"
      [attr.y]="-(handleSize / 2) - gap()"
      [attr.width]="handleSize"
      [attr.height]="handleSize"
      [attr.fill]="resizerColor()"
      (pointerStart)="startResize('top-left', $event)" />

    <!-- Top right -->
    <svg:rect
      class="top-right"
      [attr.x]="model.size().width - handleSize / 2 + gap()"
      [attr.y]="-(handleSize / 2) - gap()"
      [attr.width]="handleSize"
      [attr.height]="handleSize"
      [attr.fill]="resizerColor()"
      (pointerStart)="startResize('top-right', $event)" />

    <!-- Bottom left -->
    <svg:rect
      class="bottom-left"
      [attr.x]="-(handleSize / 2) - gap()"
      [attr.y]="model.size().height - handleSize / 2 + gap()"
      [attr.width]="handleSize"
      [attr.height]="handleSize"
      [attr.fill]="resizerColor()"
      (pointerStart)="startResize('bottom-left', $event)" />

    <!-- Bottom right -->
    <svg:rect
      class="bottom-right"
      [attr.x]="model.size().width - handleSize / 2 + gap()"
      [attr.y]="model.size().height - handleSize / 2 + gap()"
      [attr.width]="handleSize"
      [attr.height]="handleSize"
      [attr.fill]="resizerColor()"
      (pointerStart)="startResize('bottom-right', $event)" />
  </svg:g>
</ng-template>

<ng-content />
`,
      styles: [".top{cursor:n-resize}.left{cursor:w-resize}.right{cursor:e-resize}.bottom{cursor:s-resize}.top-left{cursor:nw-resize}.top-right{cursor:ne-resize}.bottom-left{cursor:sw-resize}.bottom-right{cursor:se-resize}\n"]
    }]
  }], () => [], {
    ngAfterViewInit: []
  });
})();
function calcOffset(movementX, movementY, zoom) {
  return {
    x: round(movementX / zoom),
    y: round(movementY / zoom)
  };
}
function constrainRect(rect, model, side, minWidth, minHeight, maxWidth, maxHeight) {
  let {
    x,
    y,
    width,
    height
  } = rect;
  width = Math.max(width, 0);
  height = Math.max(height, 0);
  width = Math.max(minWidth, width);
  height = Math.max(minHeight, height);
  width = Math.min(maxWidth, width);
  height = Math.min(maxHeight, height);
  x = Math.min(x, model.point().x + model.width() - minWidth);
  y = Math.min(y, model.point().y + model.height() - minHeight);
  x = Math.max(x, model.point().x + model.width() - maxWidth);
  y = Math.max(y, model.point().y + model.height() - maxHeight);
  const parent = model.parent();
  if (parent) {
    const parentWidth = parent.width();
    const parentHeight = parent.height();
    const modelX = model.point().x;
    const modelY = model.point().y;
    x = Math.max(x, 0);
    y = Math.max(y, 0);
    if (side.includes("left") && x === 0) {
      width = Math.min(width, modelX + model.width());
    }
    if (side.includes("top") && y === 0) {
      height = Math.min(height, modelY + model.height());
    }
    width = Math.min(width, parentWidth - x);
    height = Math.min(height, parentHeight - y);
  }
  const bounds = getNodesBounds(model.children());
  if (bounds) {
    if (side.includes("left")) {
      x = Math.min(x, model.point().x + model.width() - (bounds.x + bounds.width));
      width = Math.max(width, bounds.x + bounds.width);
    }
    if (side.includes("right")) {
      width = Math.max(width, bounds.x + bounds.width);
    }
    if (side.includes("bottom")) {
      height = Math.max(height, bounds.y + bounds.height);
    }
    if (side.includes("top")) {
      y = Math.min(y, model.point().y + model.height() - (bounds.y + bounds.height));
      height = Math.max(height, bounds.y + bounds.height);
    }
  }
  return {
    x,
    y,
    width,
    height
  };
}
var HandleModel = class {
  constructor(rawHandle, parentNode) {
    this.rawHandle = rawHandle;
    this.parentNode = parentNode;
    this.strokeWidth = 2;
    this.size = signal({
      width: 10 + 2 * this.strokeWidth,
      height: 10 + 2 * this.strokeWidth
    });
    this.pointAbsolute = computed(() => {
      return {
        x: this.parentNode.globalPoint().x + this.hostOffset().x + this.sizeOffset().x,
        y: this.parentNode.globalPoint().y + this.hostOffset().y + this.sizeOffset().y
      };
    });
    this.state = signal("idle");
    this.updateHostSizeAndPosition$ = new Subject();
    this.hostSize = toSignal(this.updateHostSizeAndPosition$.pipe(map(() => this.getHostSize())), {
      initialValue: {
        width: 0,
        height: 0
      }
    });
    this.hostPosition = toSignal(this.updateHostSizeAndPosition$.pipe(map(() => ({
      x: this.hostReference instanceof HTMLElement ? this.hostReference.offsetLeft : 0,
      // for now just 0 for group nodes
      y: this.hostReference instanceof HTMLElement ? this.hostReference.offsetTop : 0
      // for now just 0 for group nodes
    }))), {
      initialValue: {
        x: 0,
        y: 0
      }
    });
    this.hostOffset = computed(() => {
      switch (this.rawHandle.position) {
        case "left":
          return {
            x: -this.rawHandle.userOffsetX,
            y: -this.rawHandle.userOffsetY + this.hostPosition().y + this.hostSize().height / 2
          };
        case "right":
          return {
            x: -this.rawHandle.userOffsetX + this.parentNode.size().width,
            y: -this.rawHandle.userOffsetY + this.hostPosition().y + this.hostSize().height / 2
          };
        case "top":
          return {
            x: -this.rawHandle.userOffsetX + this.hostPosition().x + this.hostSize().width / 2,
            y: -this.rawHandle.userOffsetY
          };
        case "bottom":
          return {
            x: -this.rawHandle.userOffsetX + this.hostPosition().x + this.hostSize().width / 2,
            y: -this.rawHandle.userOffsetY + this.parentNode.size().height
          };
      }
    });
    this.sizeOffset = computed(() => {
      switch (this.rawHandle.position) {
        case "left":
          return {
            x: -(this.size().width / 2),
            y: 0
          };
        case "right":
          return {
            x: this.size().width / 2,
            y: 0
          };
        case "top":
          return {
            x: 0,
            y: -(this.size().height / 2)
          };
        case "bottom":
          return {
            x: 0,
            y: this.size().height / 2
          };
      }
    });
    this.hostReference = this.rawHandle.hostReference;
    this.template = this.rawHandle.template;
    this.templateContext = {
      $implicit: {
        point: this.hostOffset,
        state: this.state,
        node: this.parentNode.rawNode
      }
    };
  }
  updateHost() {
    this.updateHostSizeAndPosition$.next();
  }
  getHostSize() {
    if (this.hostReference instanceof HTMLElement) {
      return {
        width: this.hostReference.offsetWidth,
        height: this.hostReference.offsetHeight
      };
    } else if (this.hostReference instanceof SVGGraphicsElement) {
      return this.hostReference.getBBox();
    }
    return {
      width: 0,
      height: 0
    };
  }
};
var HandleComponent = class _HandleComponent {
  constructor() {
    this.injector = inject(Injector);
    this.handleService = inject(HandleService);
    this.element = inject(ElementRef).nativeElement;
    this.destroyRef = inject(DestroyRef);
    this.position = input.required();
    this.type = input.required();
    this.id = input();
    this.template = input();
    this.offsetX = input(0);
    this.offsetY = input(0);
  }
  ngOnInit() {
    runInInjectionContext(this.injector, () => {
      const node = this.handleService.node();
      if (node) {
        const model = new HandleModel({
          position: this.position(),
          type: this.type(),
          id: this.id(),
          hostReference: this.element.parentElement,
          template: this.template(),
          userOffsetX: this.offsetX(),
          userOffsetY: this.offsetY()
        }, node);
        this.handleService.createHandle(model);
        requestAnimationFrame(() => model.updateHost());
        this.destroyRef.onDestroy(() => this.handleService.destroyHandle(model));
      }
    });
  }
  static {
    this.ɵfac = function HandleComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _HandleComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _HandleComponent,
      selectors: [["handle"]],
      inputs: {
        position: [1, "position"],
        type: [1, "type"],
        id: [1, "id"],
        template: [1, "template"],
        offsetX: [1, "offsetX"],
        offsetY: [1, "offsetY"]
      },
      decls: 0,
      vars: 0,
      template: function HandleComponent_Template(rf, ctx) {
      },
      encapsulation: 2,
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(HandleComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "handle",
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: ""
    }]
  }], null, null);
})();
var NodeHandlesControllerDirective = class _NodeHandlesControllerDirective {
  constructor() {
    this.nodeAccessor = inject(NodeAccessorService);
    this.zone = inject(NgZone);
    this.destroyRef = inject(DestroyRef);
    this.hostElementRef = inject(ElementRef);
  }
  ngOnInit() {
    const model = this.nodeAccessor.model();
    model.handles$.pipe(switchMap((handles) => resizable([...handles.map((h) => h.hostReference), this.hostElementRef.nativeElement], this.zone).pipe(map(() => handles))), tap((handles) => {
      handles.forEach((h) => h.updateHost());
    }), takeUntilDestroyed(this.destroyRef)).subscribe();
  }
  static {
    this.ɵfac = function NodeHandlesControllerDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _NodeHandlesControllerDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _NodeHandlesControllerDirective,
      selectors: [["", "nodeHandlesController", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(NodeHandlesControllerDirective, [{
    type: Directive,
    args: [{
      selector: "[nodeHandlesController]",
      standalone: true
    }]
  }], null, null);
})();
var NodeResizeControllerDirective = class _NodeResizeControllerDirective {
  constructor() {
    this.nodeAccessor = inject(NodeAccessorService);
    this.zone = inject(NgZone);
    this.destroyRef = inject(DestroyRef);
    this.hostElementRef = inject(ElementRef);
  }
  ngOnInit() {
    const model = this.nodeAccessor.model();
    const host = this.hostElementRef.nativeElement;
    merge(resizable([host], this.zone)).pipe(startWith(null), filter(() => !model.resizing()), tap(() => {
      model.width.set(host.clientWidth);
      model.height.set(host.clientHeight);
    }), takeUntilDestroyed(this.destroyRef)).subscribe();
  }
  static {
    this.ɵfac = function NodeResizeControllerDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _NodeResizeControllerDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _NodeResizeControllerDirective,
      selectors: [["", "nodeResizeController", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(NodeResizeControllerDirective, [{
    type: Directive,
    args: [{
      selector: "[nodeResizeController]",
      standalone: true
    }]
  }], null, null);
})();
var NodeComponent = class _NodeComponent {
  constructor() {
    this.injector = inject(Injector);
    this.handleService = inject(HandleService);
    this.draggableService = inject(DraggableService);
    this.flowStatusService = inject(FlowStatusService);
    this.nodeRenderingService = inject(NodeRenderingService);
    this.flowSettingsService = inject(FlowSettingsService);
    this.selectionService = inject(SelectionService);
    this.hostRef = inject(ElementRef);
    this.nodeAccessor = inject(NodeAccessorService);
    this.overlaysService = inject(OverlaysService);
    this.connectionController = inject(ConnectionControllerDirective, {
      optional: true
    });
    this.model = input.required();
    this.nodeTemplate = input();
    this.nodeSvgTemplate = input();
    this.groupNodeTemplate = input();
    this.showMagnet = computed(() => this.flowStatusService.status().state === "connection-start" || this.flowStatusService.status().state === "connection-validation" || this.flowStatusService.status().state === "reconnection-start" || this.flowStatusService.status().state === "reconnection-validation");
    this.toolbars = computed(() => this.overlaysService.nodeToolbarsMap().get(this.model()));
  }
  ngOnInit() {
    this.model().isVisible.set(true);
    this.nodeAccessor.model.set(this.model());
    this.handleService.node.set(this.model());
    effect(() => {
      if (this.model().draggable()) {
        this.draggableService.enable(this.hostRef.nativeElement, this.model());
      } else {
        this.draggableService.disable(this.hostRef.nativeElement);
      }
    }, {
      injector: this.injector
    });
  }
  ngOnDestroy() {
    this.model().isVisible.set(false);
    this.draggableService.destroy(this.hostRef.nativeElement);
  }
  startConnection(event, handle) {
    event.stopPropagation();
    this.connectionController?.startConnection(handle);
  }
  validateConnection(handle) {
    this.connectionController?.validateConnection(handle);
  }
  resetValidateConnection(targetHandle) {
    this.connectionController?.resetValidateConnection(targetHandle);
  }
  endConnection() {
    this.connectionController?.endConnection();
  }
  pullNode() {
    if (this.flowSettingsService.elevateNodesOnSelect()) {
      this.nodeRenderingService.pullNode(this.model());
    }
  }
  selectNode() {
    if (this.flowSettingsService.entitiesSelectable()) {
      this.selectionService.select(this.model());
    }
  }
  static {
    this.ɵfac = function NodeComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _NodeComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _NodeComponent,
      selectors: [["g", "node", ""]],
      hostAttrs: [1, "vflow-node"],
      inputs: {
        model: [1, "model"],
        nodeTemplate: [1, "nodeTemplate"],
        nodeSvgTemplate: [1, "nodeSvgTemplate"],
        groupNodeTemplate: [1, "groupNodeTemplate"]
      },
      features: [ɵɵProvidersFeature([HandleService, NodeAccessorService])],
      attrs: _c6,
      decls: 11,
      vars: 7,
      consts: [[1, "selectable"], ["nodeHandlesController", "", 1, "selectable"], ["rx", "5", "ry", "5", 1, "default-group-node", 3, "resizable", "gap", "resizerColor", "default-group-node_selected", "stroke", "fill"], [1, "selectable", 3, "click"], ["nodeHandlesController", "", 3, "selected"], [3, "outerHTML"], ["type", "source", "position", "right"], ["type", "target", "position", "left"], ["nodeHandlesController", "", "nodeResizeController", "", 1, "wrapper"], [3, "ngTemplateOutlet", "ngTemplateOutletContext", "ngTemplateOutletInjector"], ["nodeHandlesController", "", 1, "selectable", 3, "click"], [3, "ngComponentOutlet", "ngComponentOutletInputs", "ngComponentOutletInjector"], ["rx", "5", "ry", "5", 1, "default-group-node", 3, "click", "resizable", "gap", "resizerColor"], [3, "ngTemplateOutlet"], ["r", "5", 1, "default-handle"], [3, "handleSizeController"], [1, "magnet"], ["r", "5", 1, "default-handle", 3, "pointerStart", "pointerEnd"], [3, "pointerStart", "pointerEnd", "handleSizeController"], [4, "ngTemplateOutlet", "ngTemplateOutletContext"], [1, "magnet", 3, "pointerEnd", "pointerOver", "pointerOut"]],
      template: function NodeComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵconditionalCreate(0, NodeComponent_Conditional_0_Template, 5, 12, ":svg:foreignObject", 0);
          ɵɵconditionalCreate(1, NodeComponent_Conditional_1_Template, 3, 9, ":svg:foreignObject", 0);
          ɵɵconditionalCreate(2, NodeComponent_Conditional_2_Template, 2, 3, ":svg:g", 1);
          ɵɵconditionalCreate(3, NodeComponent_Conditional_3_Template, 2, 3);
          ɵɵconditionalCreate(4, NodeComponent_Conditional_4_Template, 1, 11, ":svg:rect", 2);
          ɵɵconditionalCreate(5, NodeComponent_Conditional_5_Template, 2, 3, ":svg:g", 1);
          ɵɵconditionalCreate(6, NodeComponent_Conditional_6_Template, 1, 1);
          ɵɵrepeaterCreate(7, NodeComponent_For_8_Template, 4, 4, null, null, ɵɵrepeaterTrackByIdentity);
          ɵɵrepeaterCreate(9, NodeComponent_For_10_Template, 2, 4, ":svg:foreignObject", null, ɵɵrepeaterTrackByIdentity);
        }
        if (rf & 2) {
          let tmp_6_0;
          ɵɵconditional(ctx.model().rawNode.type === "default" ? 0 : -1);
          ɵɵadvance();
          ɵɵconditional(ctx.model().rawNode.type === "html-template" && ctx.nodeTemplate() ? 1 : -1);
          ɵɵadvance();
          ɵɵconditional(ctx.model().rawNode.type === "svg-template" && ctx.nodeSvgTemplate() ? 2 : -1);
          ɵɵadvance();
          ɵɵconditional(ctx.model().isComponentType ? 3 : -1);
          ɵɵadvance();
          ɵɵconditional(ctx.model().rawNode.type === "default-group" ? 4 : -1);
          ɵɵadvance();
          ɵɵconditional(ctx.model().rawNode.type === "template-group" && ctx.groupNodeTemplate() ? 5 : -1);
          ɵɵadvance();
          ɵɵconditional((tmp_6_0 = ctx.model().resizerTemplate()) ? 6 : -1, tmp_6_0);
          ɵɵadvance();
          ɵɵrepeater(ctx.model().handles());
          ɵɵadvance(2);
          ɵɵrepeater(ctx.toolbars());
        }
      },
      dependencies: [PointerDirective, DefaultNodeComponent, HandleComponent, NgTemplateOutlet, NgComponentOutlet, ResizableComponent, HandleSizeControllerDirective, NodeHandlesControllerDirective, NodeResizeControllerDirective, AsyncPipe],
      styles: [".magnet[_ngcontent-%COMP%]{opacity:0}.wrapper[_ngcontent-%COMP%]{display:table-cell}.default-group-node[_ngcontent-%COMP%]{stroke-width:1.5px;fill-opacity:.05}.default-group-node_selected[_ngcontent-%COMP%]{stroke-width:2px}.default-handle[_ngcontent-%COMP%]{stroke:#fff;fill:#1b262c}"],
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(NodeComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "g[node]",
      changeDetection: ChangeDetectionStrategy.OnPush,
      providers: [HandleService, NodeAccessorService],
      host: {
        class: "vflow-node"
      },
      imports: [PointerDirective, DefaultNodeComponent, HandleComponent, NgTemplateOutlet, NgComponentOutlet, ResizableComponent, HandleSizeControllerDirective, NodeHandlesControllerDirective, NodeResizeControllerDirective, AsyncPipe],
      template: `<!-- Default node -->
@if (model().rawNode.type === 'default') {
  <svg:foreignObject
    class="selectable"
    [attr.width]="model().foWidth()"
    [attr.height]="model().foHeight()"
    (click)="pullNode(); selectNode()">
    <default-node
      nodeHandlesController
      [selected]="model().selected()"
      [style.width]="model().styleWidth()"
      [style.height]="model().styleHeight()"
      [style.max-width]="model().styleWidth()"
      [style.max-height]="model().styleHeight()">
      <div [outerHTML]="model().text()"></div>

      <handle type="source" position="right" />
      <handle type="target" position="left" />
    </default-node>
  </svg:foreignObject>
}

<!-- HTML Template node -->
@if (model().rawNode.type === 'html-template' && nodeTemplate()) {
  <svg:foreignObject
    class="selectable"
    [attr.width]="model().foWidth()"
    [attr.height]="model().foHeight()"
    (click)="pullNode()">
    <div
      nodeHandlesController
      nodeResizeController
      class="wrapper"
      [style.width]="model().styleWidth()"
      [style.height]="model().styleHeight()">
      <ng-container
        [ngTemplateOutlet]="nodeTemplate() ?? null"
        [ngTemplateOutletContext]="model().context"
        [ngTemplateOutletInjector]="injector" />
    </div>
  </svg:foreignObject>
}

<!-- SVG Template node -->
@if (model().rawNode.type === 'svg-template' && nodeSvgTemplate()) {
  <svg:g class="selectable" nodeHandlesController (click)="pullNode()">
    <ng-container
      [ngTemplateOutlet]="nodeSvgTemplate() ?? null"
      [ngTemplateOutletContext]="model().context"
      [ngTemplateOutletInjector]="injector" />
  </svg:g>
}

<!-- Component node -->
@if (model().isComponentType) {
  @if (model().componentInstance$ | async; as component) {
    <svg:foreignObject
      class="selectable"
      [attr.width]="model().foWidth()"
      [attr.height]="model().foHeight()"
      (click)="pullNode()">
      <div
        nodeHandlesController
        nodeResizeController
        class="wrapper"
        [style.width]="model().styleWidth()"
        [style.height]="model().styleHeight()">
        <ng-container
          [ngComponentOutlet]="$any(component)"
          [ngComponentOutletInputs]="model().componentTypeInputs"
          [ngComponentOutletInjector]="injector" />
      </div>
    </svg:foreignObject>
  }
}

<!-- Default group node -->
@if (model().rawNode.type === 'default-group') {
  <svg:rect
    class="default-group-node"
    rx="5"
    ry="5"
    [resizable]="model().resizable()"
    [gap]="3"
    [resizerColor]="model().color()"
    [class.default-group-node_selected]="model().selected()"
    [attr.width]="model().size().width"
    [attr.height]="model().size().height"
    [style.stroke]="model().color()"
    [style.fill]="model().color()"
    (click)="pullNode(); selectNode()" />
}

<!-- Template group node  -->
@if (model().rawNode.type === 'template-group' && groupNodeTemplate()) {
  <svg:g class="selectable" nodeHandlesController (click)="pullNode()">
    <ng-container
      [ngTemplateOutlet]="groupNodeTemplate() ?? null"
      [ngTemplateOutletContext]="model().context"
      [ngTemplateOutletInjector]="injector" />
  </svg:g>
}

<!-- Resizer -->
@if (model().resizerTemplate(); as template) {
  @if (model().resizable()) {
    <ng-template [ngTemplateOutlet]="template" />
  }
}

<!-- Handles -->
@for (handle of model().handles(); track handle) {
  @if (handle.template === undefined) {
    <svg:circle
      class="default-handle"
      r="5"
      [attr.cx]="handle.hostOffset().x"
      [attr.cy]="handle.hostOffset().y"
      [attr.stroke-width]="handle.strokeWidth"
      (pointerStart)="startConnection($event, handle)"
      (pointerEnd)="endConnection()" />
  }

  @if (handle.template === null) {
    <svg:g
      [handleSizeController]="handle"
      (pointerStart)="startConnection($event, handle)"
      (pointerEnd)="endConnection()" />
  }

  @if (handle.template) {
    <svg:g
      [handleSizeController]="handle"
      (pointerStart)="startConnection($event, handle)"
      (pointerEnd)="endConnection()">
      <ng-container *ngTemplateOutlet="handle.template; context: handle.templateContext" />
    </svg:g>
  }

  @if (showMagnet()) {
    <svg:circle
      class="magnet"
      [attr.r]="model().magnetRadius"
      [attr.cx]="handle.hostOffset().x"
      [attr.cy]="handle.hostOffset().y"
      (pointerEnd)="endConnection(); resetValidateConnection(handle)"
      (pointerOver)="validateConnection(handle)"
      (pointerOut)="resetValidateConnection(handle)" />
  }
}

<!-- Toolbar -->
@for (toolbar of toolbars(); track toolbar) {
  <svg:foreignObject
    [attr.width]="toolbar.size().width"
    [attr.height]="toolbar.size().height"
    [attr.transform]="toolbar.transform()">
    <ng-container [ngTemplateOutlet]="toolbar.template()" />
  </svg:foreignObject>
}
`,
      styles: [".magnet{opacity:0}.wrapper{display:table-cell}.default-group-node{stroke-width:1.5px;fill-opacity:.05}.default-group-node_selected{stroke-width:2px}.default-handle{stroke:#fff;fill:#1b262c}\n"]
    }]
  }], null, null);
})();
var ConnectionComponent = class _ConnectionComponent {
  constructor() {
    this.flowStatusService = inject(FlowStatusService);
    this.spacePointContext = inject(SpacePointContextDirective);
    this.flowEntitiesService = inject(FlowEntitiesService);
    this.model = input.required();
    this.template = input();
    this.path = computed(() => {
      const status = this.flowStatusService.status();
      const curve = this.model().curve;
      if (status.state === "connection-start" || status.state === "reconnection-start") {
        const sourceHandle = status.payload.sourceHandle;
        const sourcePoint = sourceHandle.pointAbsolute();
        const sourcePosition = sourceHandle.rawHandle.position;
        const targetPoint = this.spacePointContext.svgCurrentSpacePoint();
        const targetPosition = getOppositePostion(sourceHandle.rawHandle.position);
        const params = this.getPathFactoryParams(sourcePoint, targetPoint, sourcePosition, targetPosition);
        switch (curve) {
          case "straight":
            return straightPath(params).path;
          case "bezier":
            return bezierPath(params).path;
          case "smooth-step":
            return smoothStepPath(params).path;
          case "step":
            return smoothStepPath(params, 0).path;
          default:
            return curve(params).path;
        }
      }
      if (status.state === "connection-validation" || status.state === "reconnection-validation") {
        const sourceHandle = status.payload.sourceHandle;
        const sourcePoint = sourceHandle.pointAbsolute();
        const sourcePosition = sourceHandle.rawHandle.position;
        const targetHandle = status.payload.targetHandle;
        const targetPoint = status.payload.valid ? targetHandle.pointAbsolute() : this.spacePointContext.svgCurrentSpacePoint();
        const targetPosition = status.payload.valid ? targetHandle.rawHandle.position : getOppositePostion(sourceHandle.rawHandle.position);
        const params = this.getPathFactoryParams(sourcePoint, targetPoint, sourcePosition, targetPosition);
        switch (curve) {
          case "straight":
            return straightPath(params).path;
          case "bezier":
            return bezierPath(params).path;
          case "smooth-step":
            return smoothStepPath(params).path;
          case "step":
            return smoothStepPath(params, 0).path;
          default:
            return curve(params).path;
        }
      }
      return null;
    });
    this.markerUrl = computed(() => {
      const marker = this.model().settings.marker;
      if (marker) {
        return `url(#${hashCode(JSON.stringify(marker))})`;
      }
      return "";
    });
    this.defaultColor = "rgb(177, 177, 183)";
  }
  // TODO: move context to model
  getContext() {
    return {
      $implicit: {
        path: this.path,
        marker: this.markerUrl
      }
    };
  }
  getPathFactoryParams(sourcePoint, targetPoint, sourcePosition, targetPosition) {
    return {
      mode: "connection",
      sourcePoint,
      targetPoint,
      sourcePosition,
      targetPosition,
      allEdges: this.flowEntitiesService.rawEdges(),
      allNodes: this.flowEntitiesService.rawNodes()
    };
  }
  static {
    this.ɵfac = function ConnectionComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _ConnectionComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _ConnectionComponent,
      selectors: [["g", "connection", ""]],
      inputs: {
        model: [1, "model"],
        template: [1, "template"]
      },
      attrs: _c7,
      decls: 2,
      vars: 2,
      consts: [["fill", "none", "stroke-width", "2"], [4, "ngTemplateOutlet", "ngTemplateOutletContext"]],
      template: function ConnectionComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵconditionalCreate(0, ConnectionComponent_Conditional_0_Template, 1, 1);
          ɵɵconditionalCreate(1, ConnectionComponent_Conditional_1_Template, 1, 1);
        }
        if (rf & 2) {
          ɵɵconditional(ctx.model().type === "default" ? 0 : -1);
          ɵɵadvance();
          ɵɵconditional(ctx.model().type === "template" ? 1 : -1);
        }
      },
      dependencies: [NgTemplateOutlet],
      encapsulation: 2,
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ConnectionComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "g[connection]",
      template: `
    @if (model().type === 'default') {
      @if (path(); as path) {
        <svg:path
          fill="none"
          stroke-width="2"
          [attr.d]="path"
          [attr.marker-end]="markerUrl()"
          [attr.stroke]="defaultColor" />
      }
    }

    @if (model().type === 'template') {
      @if (template(); as template) {
        <ng-container *ngTemplateOutlet="template; context: getContext()" />
      }
    }
  `,
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NgTemplateOutlet]
    }]
  }], null, null);
})();
function getOppositePostion(position) {
  switch (position) {
    case "top":
      return "bottom";
    case "bottom":
      return "top";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}
function id2() {
  const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return randomLetter + Date.now();
}
var defaultBg = "#fff";
var defaultGap = 20;
var defaultDotSize = 2;
var defaultDotColor = "rgb(177, 177, 183)";
var defaultImageScale = 0.1;
var defaultRepeated = true;
var BackgroundComponent = class _BackgroundComponent {
  constructor() {
    this.viewportService = inject(ViewportService);
    this.rootSvg = inject(RootSvgReferenceDirective).element;
    this.settingsService = inject(FlowSettingsService);
    this.backgroundSignal = this.settingsService.background;
    this.scaledGap = computed(() => {
      const background = this.backgroundSignal();
      if (background.type === "dots") {
        const zoom = this.viewportService.readableViewport().zoom;
        return zoom * (background.gap ?? defaultGap);
      }
      return 0;
    });
    this.x = computed(() => this.viewportService.readableViewport().x % this.scaledGap());
    this.y = computed(() => this.viewportService.readableViewport().y % this.scaledGap());
    this.patternColor = computed(() => {
      const bg = this.backgroundSignal();
      if (bg.type === "dots") {
        return bg.color ?? defaultDotColor;
      }
      return defaultDotColor;
    });
    this.patternSize = computed(() => {
      const background = this.backgroundSignal();
      if (background.type === "dots") {
        return this.viewportService.readableViewport().zoom * (background.size ?? defaultDotSize) / 2;
      }
      return 0;
    });
    this.bgImageSrc = computed(() => {
      const background = this.backgroundSignal();
      return background.type === "image" ? background.src : "";
    });
    this.imageSize = toLazySignal(toObservable(this.backgroundSignal).pipe(switchMap(() => createImage(this.bgImageSrc())), map((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight
    }))), {
      initialValue: {
        width: 0,
        height: 0
      }
    });
    this.scaledImageWidth = computed(() => {
      const background = this.backgroundSignal();
      if (background.type === "image") {
        const zoom = background.fixed ? 1 : this.viewportService.readableViewport().zoom;
        return this.imageSize().width * zoom * (background.scale ?? defaultImageScale);
      }
      return 0;
    });
    this.scaledImageHeight = computed(() => {
      const background = this.backgroundSignal();
      if (background.type === "image") {
        const zoom = background.fixed ? 1 : this.viewportService.readableViewport().zoom;
        return this.imageSize().height * zoom * (background.scale ?? defaultImageScale);
      }
      return 0;
    });
    this.imageX = computed(() => {
      const background = this.backgroundSignal();
      if (background.type === "image") {
        if (!background.repeat) {
          return background.fixed ? 0 : this.viewportService.readableViewport().x;
        }
        return background.fixed ? 0 : this.viewportService.readableViewport().x % this.scaledImageWidth();
      }
      return 0;
    });
    this.imageY = computed(() => {
      const background = this.backgroundSignal();
      if (background.type === "image") {
        if (!background.repeat) {
          return background.fixed ? 0 : this.viewportService.readableViewport().y;
        }
        return background.fixed ? 0 : this.viewportService.readableViewport().y % this.scaledImageHeight();
      }
      return 0;
    });
    this.repeated = computed(() => {
      const background = this.backgroundSignal();
      return background.type === "image" && (background.repeat ?? defaultRepeated);
    });
    this.patternId = id2();
    this.patternUrl = `url(#${this.patternId})`;
    effect(() => {
      const background = this.backgroundSignal();
      if (background.type === "dots") {
        this.rootSvg.style.backgroundColor = background.backgroundColor ?? defaultBg;
      }
      if (background.type === "solid") {
        this.rootSvg.style.backgroundColor = background.color;
      }
    });
  }
  static {
    this.ɵfac = function BackgroundComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _BackgroundComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _BackgroundComponent,
      selectors: [["g", "background", ""]],
      attrs: _c8,
      decls: 2,
      vars: 2,
      consts: [["patternUnits", "userSpaceOnUse"], ["x", "0", "y", "0", "width", "100%", "height", "100%"]],
      template: function BackgroundComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵconditionalCreate(0, BackgroundComponent_Conditional_0_Template, 3, 10);
          ɵɵconditionalCreate(1, BackgroundComponent_Conditional_1_Template, 2, 2);
        }
        if (rf & 2) {
          ɵɵconditional(ctx.backgroundSignal().type === "dots" ? 0 : -1);
          ɵɵadvance();
          ɵɵconditional(ctx.backgroundSignal().type === "image" ? 1 : -1);
        }
      },
      encapsulation: 2,
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(BackgroundComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "g[background]",
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `@if (backgroundSignal().type === 'dots') {
  <svg:pattern
    patternUnits="userSpaceOnUse"
    [attr.id]="patternId"
    [attr.x]="x()"
    [attr.y]="y()"
    [attr.width]="scaledGap()"
    [attr.height]="scaledGap()">
    <svg:circle
      [attr.cx]="patternSize()"
      [attr.cy]="patternSize()"
      [attr.r]="patternSize()"
      [attr.fill]="patternColor()" />
  </svg:pattern>

  <svg:rect x="0" y="0" width="100%" height="100%" [attr.fill]="patternUrl" />
}

@if (backgroundSignal().type === 'image') {
  @if (repeated()) {
    <svg:pattern
      patternUnits="userSpaceOnUse"
      [attr.id]="patternId"
      [attr.x]="imageX()"
      [attr.y]="imageY()"
      [attr.width]="scaledImageWidth()"
      [attr.height]="scaledImageHeight()">
      <svg:image [attr.href]="bgImageSrc()" [attr.width]="scaledImageWidth()" [attr.height]="scaledImageHeight()" />
    </svg:pattern>

    <svg:rect x="0" y="0" width="100%" height="100%" [attr.fill]="patternUrl" />
  }

  @if (!repeated()) {
    <svg:image
      [attr.x]="imageX()"
      [attr.y]="imageY()"
      [attr.width]="scaledImageWidth()"
      [attr.height]="scaledImageHeight()"
      [attr.href]="bgImageSrc()" />
  }
}
`
    }]
  }], () => [], null);
})();
function createImage(url) {
  const image = new Image();
  image.src = url;
  return new Promise((resolve) => {
    image.onload = () => resolve(image);
  });
}
var DefsComponent = class _DefsComponent {
  constructor() {
    this.markers = input.required();
    this.defaultColor = "rgb(177, 177, 183)";
  }
  static {
    this.ɵfac = function DefsComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _DefsComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _DefsComponent,
      selectors: [["defs", "flowDefs", ""]],
      inputs: {
        markers: [1, "markers"]
      },
      attrs: _c9,
      decls: 3,
      vars: 2,
      consts: [["viewBox", "-10 -10 20 20", "refX", "0", "refY", "0"], ["points", "-5,-4 1,0 -5,4 -5,-4", 1, "marker__arrow_closed", 3, "stroke", "stroke-width", "fill"], ["points", "-5,-4 0,0 -5,4", 1, "marker__arrow_default", 3, "stroke", "stroke-width"], ["points", "-5,-4 1,0 -5,4 -5,-4", 1, "marker__arrow_closed"], ["points", "-5,-4 0,0 -5,4", 1, "marker__arrow_default"]],
      template: function DefsComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵrepeaterCreate(0, DefsComponent_For_1_Template, 3, 7, ":svg:marker", 0, ɵɵrepeaterTrackByIdentity);
          ɵɵpipe(2, "keyvalue");
        }
        if (rf & 2) {
          ɵɵrepeater(ɵɵpipeBind1(2, 0, ctx.markers()));
        }
      },
      dependencies: [KeyValuePipe],
      styles: [".marker__arrow_default[_ngcontent-%COMP%]{stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;fill:none}.marker__arrow_closed[_ngcontent-%COMP%]{stroke-linecap:round;stroke-linejoin:round}"],
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(DefsComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "defs[flowDefs]",
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [KeyValuePipe],
      template: `@for (marker of markers() | keyvalue; track marker) {
  <svg:marker
    viewBox="-10 -10 20 20"
    refX="0"
    refY="0"
    [attr.id]="marker.key"
    [attr.markerWidth]="marker.value.width ?? 16.5"
    [attr.markerHeight]="marker.value.height ?? 16.5"
    [attr.orient]="marker.value.orient ?? 'auto-start-reverse'"
    [attr.markerUnits]="marker.value.markerUnits ?? 'userSpaceOnUse'">
    @if (marker.value.type === 'arrow-closed' || !marker.value.type) {
      <polyline
        class="marker__arrow_closed"
        points="-5,-4 1,0 -5,4 -5,-4"
        [style.stroke]="marker.value.color ?? defaultColor"
        [style.stroke-width]="marker.value.strokeWidth ?? 2"
        [style.fill]="marker.value.color ?? defaultColor" />
    }

    @if (marker.value.type === 'arrow') {
      <polyline
        class="marker__arrow_default"
        points="-5,-4 0,0 -5,4"
        [style.stroke]="marker.value.color ?? defaultColor"
        [style.stroke-width]="marker.value.strokeWidth ?? 2" />
    }
  </svg:marker>
}
`,
      styles: [".marker__arrow_default{stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;fill:none}.marker__arrow_closed{stroke-linecap:round;stroke-linejoin:round}\n"]
    }]
  }], null, null);
})();
var FlowSizeControllerDirective = class _FlowSizeControllerDirective {
  constructor() {
    this.host = inject(ElementRef);
    this.flowSettingsService = inject(FlowSettingsService);
    this.flowWidth = computed(() => {
      const view = this.flowSettingsService.view();
      return view === "auto" ? "100%" : view[0];
    });
    this.flowHeight = computed(() => {
      const view = this.flowSettingsService.view();
      return view === "auto" ? "100%" : view[1];
    });
    resizable([this.host.nativeElement], inject(NgZone)).pipe(tap(([entry]) => {
      this.flowSettingsService.computedFlowWidth.set(entry.contentRect.width);
      this.flowSettingsService.computedFlowHeight.set(entry.contentRect.height);
    }), takeUntilDestroyed()).subscribe();
  }
  static {
    this.ɵfac = function FlowSizeControllerDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _FlowSizeControllerDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _FlowSizeControllerDirective,
      selectors: [["svg", "flowSizeController", ""]],
      hostVars: 2,
      hostBindings: function FlowSizeControllerDirective_HostBindings(rf, ctx) {
        if (rf & 2) {
          ɵɵattribute("width", ctx.flowWidth())("height", ctx.flowHeight());
        }
      }
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(FlowSizeControllerDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "svg[flowSizeController]",
      host: {
        "[attr.width]": "flowWidth()",
        "[attr.height]": "flowHeight()"
      }
    }]
  }], () => [], null);
})();
var RootSvgContextDirective = class _RootSvgContextDirective {
  constructor() {
    this.flowStatusService = inject(FlowStatusService);
  }
  // TODO: check for multiple instances on page
  resetConnection() {
    const status = this.flowStatusService.status();
    if (status.state === "connection-start" || status.state === "reconnection-start") {
      this.flowStatusService.setIdleStatus();
    }
  }
  static {
    this.ɵfac = function RootSvgContextDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _RootSvgContextDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _RootSvgContextDirective,
      selectors: [["svg", "rootSvgContext", ""]],
      hostBindings: function RootSvgContextDirective_HostBindings(rf, ctx) {
        if (rf & 1) {
          ɵɵlistener("mouseup", function RootSvgContextDirective_mouseup_HostBindingHandler() {
            return ctx.resetConnection();
          }, ɵɵresolveDocument)("touchend", function RootSvgContextDirective_touchend_HostBindingHandler() {
            return ctx.resetConnection();
          }, ɵɵresolveDocument)("contextmenu", function RootSvgContextDirective_contextmenu_HostBindingHandler() {
            return ctx.resetConnection();
          });
        }
      }
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(RootSvgContextDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "svg[rootSvgContext]"
    }]
  }], null, {
    resetConnection: [{
      type: HostListener,
      args: ["document:mouseup"]
    }, {
      type: HostListener,
      args: ["document:touchend"]
    }, {
      type: HostListener,
      args: ["contextmenu"]
    }]
  });
})();
function getSpacePoints(point, groups) {
  const result = [];
  for (const group of groups) {
    const {
      x,
      y
    } = group.globalPoint();
    if (point.x >= x && point.x <= x + group.width() && point.y >= y && point.y <= y + group.height()) {
      result.push({
        x: point.x - x,
        y: point.y - y,
        spaceNodeId: group.rawNode.id
      });
    }
  }
  result.reverse();
  result.push({
    spaceNodeId: null,
    x: point.x,
    y: point.y
  });
  return result;
}
var PreviewFlowRenderStrategyService = class _PreviewFlowRenderStrategyService {
  static {
    this.ɵfac = function PreviewFlowRenderStrategyService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _PreviewFlowRenderStrategyService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _PreviewFlowRenderStrategyService,
      factory: _PreviewFlowRenderStrategyService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(PreviewFlowRenderStrategyService, [{
    type: Injectable
  }], null, null);
})();
var ViewportPreviewFlowRenderStrategyService = class _ViewportPreviewFlowRenderStrategyService extends PreviewFlowRenderStrategyService {
  shouldRenderNode(node) {
    return !node.isVisible();
  }
  static {
    this.ɵfac = /* @__PURE__ */ (() => {
      let ɵViewportPreviewFlowRenderStrategyService_BaseFactory;
      return function ViewportPreviewFlowRenderStrategyService_Factory(__ngFactoryType__) {
        return (ɵViewportPreviewFlowRenderStrategyService_BaseFactory || (ɵViewportPreviewFlowRenderStrategyService_BaseFactory = ɵɵgetInheritedFactory(_ViewportPreviewFlowRenderStrategyService)))(__ngFactoryType__ || _ViewportPreviewFlowRenderStrategyService);
      };
    })();
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _ViewportPreviewFlowRenderStrategyService,
      factory: _ViewportPreviewFlowRenderStrategyService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ViewportPreviewFlowRenderStrategyService, [{
    type: Injectable
  }], null, null);
})();
function drawNode(ctx, node) {
  if (Object.keys(node.preview().style).length) {
    drawStyledNode(ctx, node);
    return;
  }
  if (node.rawNode.type === "default") {
    drawDefaultNode(ctx, node);
    return;
  }
  if (node.rawNode.type === "default-group") {
    drawDefaultGroupNode(ctx, node);
    return;
  }
  drawUnknownNode(ctx, node);
}
function drawDefaultNode(ctx, node) {
  const point = node.globalPoint();
  const width = node.width();
  const height = node.height();
  borderRadius(ctx, node, 5);
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.strokeStyle = "#1b262c";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "black";
  ctx.font = "14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const centerX = point.x + width / 2;
  const centerY = point.y + height / 2;
  ctx.fillText(node.text(), centerX, centerY);
}
function drawDefaultGroupNode(ctx, node) {
  const point = node.globalPoint();
  const width = node.width();
  const height = node.height();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = node.color();
  ctx.fillRect(point.x, point.y, width, height);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = node.color();
  ctx.lineWidth = 1.5;
  ctx.strokeRect(point.x, point.y, width, height);
}
function drawStyledNode(ctx, node) {
  const point = node.globalPoint();
  const width = node.width();
  const height = node.height();
  const style = node.preview().style;
  if (style.borderRadius) {
    const radius = parseFloat(style.borderRadius);
    borderRadius(ctx, node, radius);
  } else {
    ctx.beginPath();
    ctx.rect(point.x, point.y, width, height);
    ctx.closePath();
  }
  if (style.backgroundColor) {
    ctx.fillStyle = style.backgroundColor;
  }
  if (style.borderColor) {
    ctx.strokeStyle = style.borderColor;
  }
  if (style.borderWidth) {
    ctx.lineWidth = parseFloat(style.borderWidth);
  }
  ctx.fill();
  ctx.stroke();
}
function drawUnknownNode(ctx, node) {
  const point = node.globalPoint();
  const width = node.width();
  const height = node.height();
  ctx.fillStyle = "rgb(0 0 0 / 10%)";
  ctx.fillRect(point.x, point.y, width, height);
}
function borderRadius(ctx, node, radius) {
  const point = node.globalPoint();
  const width = node.width();
  const height = node.height();
  ctx.beginPath();
  ctx.moveTo(point.x + radius, point.y);
  ctx.lineTo(point.x + width - radius, point.y);
  ctx.quadraticCurveTo(point.x + width, point.y, point.x + width, point.y + radius);
  ctx.lineTo(point.x + width, point.y + height - radius);
  ctx.quadraticCurveTo(point.x + width, point.y + height, point.x + width - radius, point.y + height);
  ctx.lineTo(point.x + radius, point.y + height);
  ctx.quadraticCurveTo(point.x, point.y + height, point.x, point.y + height - radius);
  ctx.lineTo(point.x, point.y + radius);
  ctx.quadraticCurveTo(point.x, point.y, point.x + radius, point.y);
  ctx.closePath();
}
var PreviewFlowComponent = class _PreviewFlowComponent {
  constructor() {
    this.viewportService = inject(ViewportService);
    this.renderStrategy = inject(PreviewFlowRenderStrategyService);
    this.nodeRenderingService = inject(NodeRenderingService);
    this.renderer2 = inject(Renderer2);
    this.element = inject(ElementRef).nativeElement;
    this.ctx = this.element.getContext("2d");
    this.width = input(0);
    this.height = input(0);
    this.dpr = window.devicePixelRatio;
    effect(() => {
      this.renderer2.setProperty(this.element, "width", this.width() * this.dpr);
      this.renderer2.setProperty(this.element, "height", this.height() * this.dpr);
      this.renderer2.setStyle(this.element, "width", `${this.width()}px`);
      this.renderer2.setStyle(this.element, "height", `${this.height()}px`);
      this.ctx.scale(this.dpr, this.dpr);
    });
    effect(() => {
      const viewport = this.viewportService.readableViewport();
      this.ctx.clearRect(0, 0, this.width(), this.height());
      this.ctx.save();
      this.ctx.setTransform(
        viewport.zoom * this.dpr,
        // horizontal scaling with DPR
        0,
        // horizontal skewing
        0,
        // vertical skewing
        viewport.zoom * this.dpr,
        // vertical scaling with DPR
        viewport.x * this.dpr,
        // horizontal translation with DPR
        viewport.y * this.dpr
      );
      for (let i = 0; i < this.nodeRenderingService.viewportNodes().length; i++) {
        const node = this.nodeRenderingService.viewportNodes()[i];
        if (this.renderStrategy.shouldRenderNode(node)) {
          drawNode(this.ctx, node);
        }
      }
      this.ctx.restore();
    });
  }
  static {
    this.ɵfac = function PreviewFlowComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _PreviewFlowComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _PreviewFlowComponent,
      selectors: [["canvas", "previewFlow", ""]],
      inputs: {
        width: [1, "width"],
        height: [1, "height"]
      },
      attrs: _c10,
      decls: 0,
      vars: 0,
      template: function PreviewFlowComponent_Template(rf, ctx) {
      },
      encapsulation: 2,
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(PreviewFlowComponent, [{
    type: Component,
    args: [{
      standalone: true,
      changeDetection: ChangeDetectionStrategy.OnPush,
      selector: "canvas[previewFlow]",
      template: ""
    }]
  }], () => [], null);
})();
var FlowRenderingService = class _FlowRenderingService {
  constructor() {
    this.nodeRenderingService = inject(NodeRenderingService);
    this.edgeRenderingService = inject(EdgeRenderingService);
    this.flowEntitiesService = inject(FlowEntitiesService);
    this.settingsService = inject(FlowSettingsService);
    this.flowInitialized = signal(false);
    inject(NgZone).runOutsideAngular(() => __async(this, null, function* () {
      yield skipFrames(2);
      this.flowInitialized.set(true);
    }));
  }
  static {
    this.ɵfac = function FlowRenderingService_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _FlowRenderingService)();
    };
  }
  static {
    this.ɵprov = ɵɵdefineInjectable({
      token: _FlowRenderingService,
      factory: _FlowRenderingService.ɵfac
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(FlowRenderingService, [{
    type: Injectable
  }], () => [], null);
})();
function skipFrames(count) {
  return new Promise((resolve) => {
    let frames = 0;
    function checkFrame() {
      frames++;
      if (frames < count) {
        requestAnimationFrame(checkFrame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(checkFrame);
  });
}
function rectToRectWithSides(rect) {
  return __spreadProps(__spreadValues({}, rect), {
    left: rect.x,
    right: rect.x + rect.width,
    top: rect.y,
    bottom: rect.y + rect.height
  });
}
var AlignmentHelperComponent = class _AlignmentHelperComponent {
  constructor() {
    this.nodeRenderingService = inject(NodeRenderingService);
    this.flowStatus = inject(FlowStatusService);
    this.tolerance = input(10);
    this.lineColor = input("#1b262c");
    this.isNodeDragging = computed(() => isNodeDragStartStatus(this.flowStatus.status()));
    this.intersections = extendedComputed((lastValue) => {
      const status = this.flowStatus.status();
      if (isNodeDragStartStatus(status)) {
        const node = status.payload.node;
        const d = rectToRectWithSides(nodeToRect(node));
        const otherRects = this.nodeRenderingService.viewportNodes().filter((n) => n !== node).filter((n) => !node.children().includes(n)).map((n) => rectToRectWithSides(nodeToRect(n)));
        const lines = [];
        let snappedX = d.x;
        let snappedY = d.y;
        let closestXDiff = Infinity;
        let closestYDiff = Infinity;
        otherRects.forEach((o) => {
          const dCenterX = d.left + d.width / 2;
          const oCenterX = o.left + o.width / 2;
          for (const [dX, oX, snapX, isCenter] of [
            // center check
            [dCenterX, oCenterX, oCenterX - d.width / 2, true],
            [d.left, o.left, o.left, false],
            [d.left, o.right, o.right, false],
            [d.right, o.left, o.left - d.width, false],
            [d.right, o.right, o.right - d.width, false]
          ]) {
            const diff = Math.abs(dX - oX);
            if (diff <= this.tolerance()) {
              const y = Math.min(d.top, o.top);
              const y2 = Math.max(d.bottom, o.bottom);
              lines.push({
                x: oX,
                y,
                x2: oX,
                y2,
                isCenter
              });
              if (diff < closestXDiff) {
                closestXDiff = diff;
                snappedX = snapX;
              }
              if (isCenter) break;
            }
          }
          const dCenterY = d.top + d.height / 2;
          const oCenterY = o.top + o.height / 2;
          for (const [dY, oY, snapY, isCenter] of [
            // center check
            [dCenterY, oCenterY, oCenterY - d.height / 2, true],
            [d.top, o.top, o.top, false],
            [d.top, o.bottom, o.bottom, false],
            [d.bottom, o.top, o.top - d.height, false],
            [d.bottom, o.bottom, o.bottom - d.height, false]
          ]) {
            const diff = Math.abs(dY - oY);
            if (diff <= this.tolerance()) {
              const x = Math.min(d.left, o.left);
              const x2 = Math.max(d.right, o.right);
              lines.push({
                x,
                y: oY,
                x2,
                y2: oY,
                isCenter
              });
              if (diff < closestYDiff) {
                closestYDiff = diff;
                snappedY = snapY;
              }
              if (isCenter) break;
            }
          }
        });
        return {
          lines,
          snappedX,
          snappedY
        };
      }
      return lastValue;
    });
    toObservable(this.flowStatus.status).pipe(filter(isNodeDragEndStatus), map((status) => status.payload.node), map((node) => [node, this.intersections()]), tap(([node, intersections]) => {
      if (intersections) {
        const snapped = {
          x: intersections.snappedX,
          y: intersections.snappedY
        };
        const parentIfExists = node.parent() ? [node.parent()] : [];
        node.setPoint(getSpacePoints(snapped, parentIfExists)[0]);
      }
    }), takeUntilDestroyed()).subscribe();
  }
  static {
    this.ɵfac = function AlignmentHelperComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _AlignmentHelperComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _AlignmentHelperComponent,
      selectors: [["g", "alignmentHelper", ""]],
      inputs: {
        tolerance: [1, "tolerance"],
        lineColor: [1, "lineColor"]
      },
      attrs: _c11,
      decls: 1,
      vars: 1,
      template: function AlignmentHelperComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵconditionalCreate(0, AlignmentHelperComponent_Conditional_0_Template, 1, 1);
        }
        if (rf & 2) {
          ɵɵconditional(ctx.isNodeDragging() ? 0 : -1);
        }
      },
      encapsulation: 2,
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(AlignmentHelperComponent, [{
    type: Component,
    args: [{
      selector: "g[alignmentHelper]",
      changeDetection: ChangeDetectionStrategy.OnPush,
      standalone: true,
      template: '@if (isNodeDragging()) {\n  @if (intersections(); as intersections) {\n    @for (intersection of intersections.lines; track $index) {\n      <svg:line\n        [attr.stroke]="lineColor()"\n        [attr.stroke-dasharray]="intersection.isCenter ? 4 : null"\n        [attr.x1]="intersection.x"\n        [attr.y1]="intersection.y"\n        [attr.x2]="intersection.x2"\n        [attr.y2]="intersection.y2" />\n    }\n  }\n}\n'
    }]
  }], () => [], null);
})();
var changesControllerHostDirective = {
  directive: ChangesControllerDirective,
  outputs: ["onNodesChange", "onNodesChange.position", "onNodesChange.position.single", "onNodesChange.position.many", "onNodesChange.size", "onNodesChange.size.single", "onNodesChange.size.many", "onNodesChange.add", "onNodesChange.add.single", "onNodesChange.add.many", "onNodesChange.remove", "onNodesChange.remove.single", "onNodesChange.remove.many", "onNodesChange.select", "onNodesChange.select.single", "onNodesChange.select.many", "onEdgesChange", "onEdgesChange.detached", "onEdgesChange.detached.single", "onEdgesChange.detached.many", "onEdgesChange.add", "onEdgesChange.add.single", "onEdgesChange.add.many", "onEdgesChange.remove", "onEdgesChange.remove.single", "onEdgesChange.remove.many", "onEdgesChange.select", "onEdgesChange.select.single", "onEdgesChange.select.many"]
};
var VflowComponent = class _VflowComponent {
  constructor() {
    this.viewportService = inject(ViewportService);
    this.flowEntitiesService = inject(FlowEntitiesService);
    this.nodesChangeService = inject(NodesChangeService);
    this.edgesChangeService = inject(EdgeChangesService);
    this.nodeRenderingService = inject(NodeRenderingService);
    this.edgeRenderingService = inject(EdgeRenderingService);
    this.flowSettingsService = inject(FlowSettingsService);
    this.componentEventBusService = inject(ComponentEventBusService);
    this.keyboardService = inject(KeyboardService);
    this.injector = inject(Injector);
    this.flowRenderingService = inject(FlowRenderingService);
    this.alignmentHelper = input(false);
    this.nodeModels = this.nodeRenderingService.nodes;
    this.groups = this.nodeRenderingService.groups;
    this.nonGroups = this.nodeRenderingService.nonGroups;
    this.edgeModels = this.edgeRenderingService.edges;
    this.onComponentNodeEvent = outputFromObservable(this.componentEventBusService.event$);
    this.nodeTemplateDirective = contentChild(NodeHtmlTemplateDirective);
    this.nodeSvgTemplateDirective = contentChild(NodeSvgTemplateDirective);
    this.groupNodeTemplateDirective = contentChild(GroupNodeTemplateDirective);
    this.edgeTemplateDirective = contentChild(EdgeTemplateDirective);
    this.edgeLabelHtmlDirective = contentChild(EdgeLabelHtmlTemplateDirective);
    this.connectionTemplateDirective = contentChild(ConnectionTemplateDirective);
    this.mapContext = viewChild(MapContextDirective);
    this.spacePointContext = viewChild.required(SpacePointContextDirective);
    this.viewport = this.viewportService.readableViewport.asReadonly();
    this.nodesChange = toLazySignal(this.nodesChangeService.changes$, {
      initialValue: []
    });
    this.edgesChange = toLazySignal(this.edgesChangeService.changes$, {
      initialValue: []
    });
    this.initialized = this.flowRenderingService.flowInitialized.asReadonly();
    this.viewportChange$ = toObservable(this.viewportService.readableViewport).pipe(skip(1));
    this.nodesChange$ = this.nodesChangeService.changes$;
    this.edgesChange$ = this.edgesChangeService.changes$;
    this.initialized$ = toObservable(this.flowRenderingService.flowInitialized);
    this.markers = this.flowEntitiesService.markers;
    this.minimap = this.flowEntitiesService.minimap;
    this.flowOptimization = this.flowSettingsService.optimization;
    this.flowWidth = this.flowSettingsService.computedFlowWidth;
    this.flowHeight = this.flowSettingsService.computedFlowHeight;
  }
  // #endregion
  // #region SETTINGS
  /**
   * Size for flow view
   *
   * accepts
   * - absolute size in format [width, height] or
   * - 'auto' to compute size based on parent element size
   */
  set view(view) {
    this.flowSettingsService.view.set(view);
  }
  /**
   * Minimum zoom value
   */
  set minZoom(value) {
    this.flowSettingsService.minZoom.set(value);
  }
  /**
   * Maximum zoom value
   */
  set maxZoom(value) {
    this.flowSettingsService.maxZoom.set(value);
  }
  /**
   * Background for flow
   */
  set background(value) {
    this.flowSettingsService.background.set(transformBackground(value));
  }
  set optimization(newOptimization) {
    this.flowSettingsService.optimization.update((optimization) => __spreadValues(__spreadValues({}, optimization), newOptimization));
  }
  /**
   * Global rule if you can or can't select entities
   */
  set entitiesSelectable(value) {
    this.flowSettingsService.entitiesSelectable.set(value);
  }
  set keyboardShortcuts(value) {
    this.keyboardService.setShortcuts(value);
  }
  /**
   * Settings for connection (it renders when user tries to create edge between nodes)
   *
   * You need to pass `ConnectionSettings` in this input.
   */
  set connection(connection) {
    this.flowEntitiesService.connection.set(connection);
  }
  get connection() {
    return this.flowEntitiesService.connection();
  }
  /**
   * Snap grid for node movement. Passes as [x, y]
   */
  set snapGrid(value) {
    this.flowSettingsService.snapGrid.set(value);
  }
  /**
   * Raizing z-index for selected node
   */
  set elevateNodesOnSelect(value) {
    this.flowSettingsService.elevateNodesOnSelect.set(value);
  }
  /**
   * Raizing z-index for selected edge
   */
  set elevateEdgesOnSelect(value) {
    this.flowSettingsService.elevateEdgesOnSelect.set(value);
  }
  // #endregion
  // #region MAIN_INPUTS
  /**
   * Nodes to render
   */
  set nodes(newNodes) {
    const models = runInInjectionContext(this.injector, () => ReferenceIdentityChecker.nodes(newNodes, this.flowEntitiesService.nodes()));
    addNodesToEdges(models, this.flowEntitiesService.edges());
    this.flowEntitiesService.nodes.set(models);
    models.forEach((model) => this.nodeRenderingService.pullNode(model));
  }
  /**
   * Edges to render
   */
  set edges(newEdges) {
    const newModels = runInInjectionContext(this.injector, () => ReferenceIdentityChecker.edges(newEdges, this.flowEntitiesService.edges()));
    addNodesToEdges(this.flowEntitiesService.nodes(), newModels);
    this.flowEntitiesService.edges.set(newModels);
  }
  // #region METHODS_API
  /**
   * Change viewport to specified state
   *
   * @param viewport viewport state
   */
  viewportTo(viewport) {
    this.viewportService.writableViewport.set({
      changeType: "absolute",
      state: viewport,
      duration: 0
    });
  }
  /**
   * Change zoom
   *
   * @param zoom zoom value
   */
  zoomTo(zoom) {
    this.viewportService.writableViewport.set({
      changeType: "absolute",
      state: {
        zoom
      },
      duration: 0
    });
  }
  /**
   * Move to specified coordinate
   *
   * @param point point where to move
   */
  panTo(point) {
    this.viewportService.writableViewport.set({
      changeType: "absolute",
      state: point,
      duration: 0
    });
  }
  fitView(options) {
    this.viewportService.fitView(options);
  }
  /**
   * Get node by id
   *
   * @param id node id
   */
  getNode(id3) {
    return this.flowEntitiesService.getNode(id3)?.rawNode;
  }
  /**
   * Sync method to get detached edges
   */
  getDetachedEdges() {
    return this.flowEntitiesService.getDetachedEdges().map((e) => e.edge);
  }
  documentPointToFlowPoint(point, options) {
    const transformedPoint = this.spacePointContext().documentPointToFlowPoint(point);
    if (options?.spaces) {
      return getSpacePoints(transformedPoint, this.nodeRenderingService.groups());
    }
    return transformedPoint;
  }
  /**
   * Gets nodes that intersect with the specified node
   *
   * @template T - The type of data associated with the nodes
   * @param nodeId - The ID of the node to check intersections for
   * @param options.partially - If true, returns nodes that partially intersect. If false, only returns fully intersecting nodes
   * @returns An array of nodes that intersect with the specified node
   */
  getIntesectingNodes(nodeId, options = {
    partially: true
  }) {
    return getIntesectingNodes(nodeId, this.nodeModels(), options).map((n) => n.rawNode);
  }
  /**
   * Converts a node's position to the coordinate space of another node
   *
   * @param nodeId - The ID of the node whose position should be converted
   * @param spaceNodeId - The ID of the node that defines the target coordinate space.
   *                      If null, returns the position in global coordinates
   * @returns {Point} The converted position. Returns {x: Infinity, y: Infinity} if either node is not found
   */
  toNodeSpace(nodeId, spaceNodeId) {
    const node = this.nodeModels().find((n) => n.rawNode.id === nodeId);
    if (!node) return {
      x: Infinity,
      y: Infinity
    };
    if (spaceNodeId === null) {
      return node.globalPoint();
    }
    const coordinateSpaceNode = this.nodeModels().find((n) => n.rawNode.id === spaceNodeId);
    if (!coordinateSpaceNode) return {
      x: Infinity,
      y: Infinity
    };
    return getSpacePoints(node.globalPoint(), [coordinateSpaceNode])[0];
  }
  // #endregion
  trackNodes(idx, {
    rawNode: node
  }) {
    return node;
  }
  trackEdges(idx, {
    edge
  }) {
    return edge;
  }
  static {
    this.ɵfac = function VflowComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _VflowComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _VflowComponent,
      selectors: [["vflow"]],
      contentQueries: function VflowComponent_ContentQueries(rf, ctx, dirIndex) {
        if (rf & 1) {
          ɵɵcontentQuerySignal(dirIndex, ctx.nodeTemplateDirective, NodeHtmlTemplateDirective, 5)(dirIndex, ctx.nodeSvgTemplateDirective, NodeSvgTemplateDirective, 5)(dirIndex, ctx.groupNodeTemplateDirective, GroupNodeTemplateDirective, 5)(dirIndex, ctx.edgeTemplateDirective, EdgeTemplateDirective, 5)(dirIndex, ctx.edgeLabelHtmlDirective, EdgeLabelHtmlTemplateDirective, 5)(dirIndex, ctx.connectionTemplateDirective, ConnectionTemplateDirective, 5);
        }
        if (rf & 2) {
          ɵɵqueryAdvance(6);
        }
      },
      viewQuery: function VflowComponent_Query(rf, ctx) {
        if (rf & 1) {
          ɵɵviewQuerySignal(ctx.mapContext, MapContextDirective, 5)(ctx.spacePointContext, SpacePointContextDirective, 5);
        }
        if (rf & 2) {
          ɵɵqueryAdvance(2);
        }
      },
      inputs: {
        view: "view",
        minZoom: "minZoom",
        maxZoom: "maxZoom",
        background: "background",
        optimization: "optimization",
        entitiesSelectable: "entitiesSelectable",
        keyboardShortcuts: "keyboardShortcuts",
        connection: [2, "connection", "connection", (settings) => new ConnectionModel(settings)],
        snapGrid: "snapGrid",
        elevateNodesOnSelect: "elevateNodesOnSelect",
        elevateEdgesOnSelect: "elevateEdgesOnSelect",
        nodes: "nodes",
        alignmentHelper: [1, "alignmentHelper"],
        edges: "edges"
      },
      outputs: {
        onComponentNodeEvent: "onComponentNodeEvent"
      },
      features: [ɵɵProvidersFeature([DraggableService, ViewportService, FlowStatusService, FlowEntitiesService, NodesChangeService, EdgeChangesService, NodeRenderingService, EdgeRenderingService, SelectionService, FlowSettingsService, ComponentEventBusService, KeyboardService, OverlaysService, {
        provide: PreviewFlowRenderStrategyService,
        useClass: ViewportPreviewFlowRenderStrategyService
      }, FlowRenderingService]), ɵɵHostDirectivesFeature([{
        directive: ChangesControllerDirective,
        outputs: ["onNodesChange", "onNodesChange", "onNodesChange.position", "onNodesChange.position", "onNodesChange.position.single", "onNodesChange.position.single", "onNodesChange.position.many", "onNodesChange.position.many", "onNodesChange.size", "onNodesChange.size", "onNodesChange.size.single", "onNodesChange.size.single", "onNodesChange.size.many", "onNodesChange.size.many", "onNodesChange.add", "onNodesChange.add", "onNodesChange.add.single", "onNodesChange.add.single", "onNodesChange.add.many", "onNodesChange.add.many", "onNodesChange.remove", "onNodesChange.remove", "onNodesChange.remove.single", "onNodesChange.remove.single", "onNodesChange.remove.many", "onNodesChange.remove.many", "onNodesChange.select", "onNodesChange.select", "onNodesChange.select.single", "onNodesChange.select.single", "onNodesChange.select.many", "onNodesChange.select.many", "onEdgesChange", "onEdgesChange", "onEdgesChange.detached", "onEdgesChange.detached", "onEdgesChange.detached.single", "onEdgesChange.detached.single", "onEdgesChange.detached.many", "onEdgesChange.detached.many", "onEdgesChange.add", "onEdgesChange.add", "onEdgesChange.add.single", "onEdgesChange.add.single", "onEdgesChange.add.many", "onEdgesChange.add.many", "onEdgesChange.remove", "onEdgesChange.remove", "onEdgesChange.remove.single", "onEdgesChange.remove.single", "onEdgesChange.remove.many", "onEdgesChange.remove.many", "onEdgesChange.select", "onEdgesChange.select", "onEdgesChange.select.single", "onEdgesChange.select.single", "onEdgesChange.select.many", "onEdgesChange.select.many"]
      }])],
      decls: 11,
      vars: 8,
      consts: [["flow", ""], ["rootSvgRef", "", "rootSvgContext", "", "rootPointer", "", "flowSizeController", "", 1, "root-svg"], ["flowDefs", "", 3, "markers"], ["background", ""], ["mapContext", "", "spacePointContext", ""], ["connection", "", 3, "model", "template"], [3, "ngTemplateOutlet"], ["previewFlow", "", 1, "preview-flow", 3, "width", "height"], ["alignmentHelper", ""], ["alignmentHelper", "", 3, "tolerance", "lineColor"], ["node", "", 3, "model", "groupNodeTemplate"], ["edge", "", 3, "model", "edgeTemplate", "edgeLabelHtmlTemplate"], ["node", "", 3, "model", "nodeTemplate", "nodeSvgTemplate"], ["node", "", 3, "model", "nodeTemplate", "nodeSvgTemplate", "groupNodeTemplate"]],
      template: function VflowComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵnamespaceSVG();
          ɵɵelementStart(0, "svg", 1, 0);
          ɵɵelement(2, "defs", 2)(3, "g", 3);
          ɵɵelementStart(4, "g", 4);
          ɵɵconditionalCreate(5, VflowComponent_Conditional_5_Template, 2, 1);
          ɵɵelement(6, "g", 5);
          ɵɵconditionalCreate(7, VflowComponent_Conditional_7_Template, 6, 0);
          ɵɵconditionalCreate(8, VflowComponent_Conditional_8_Template, 4, 0);
          ɵɵelementEnd();
          ɵɵconditionalCreate(9, VflowComponent_Conditional_9_Template, 1, 1, ":svg:ng-container", 6);
          ɵɵelementEnd();
          ɵɵconditionalCreate(10, VflowComponent_Conditional_10_Template, 1, 2, "canvas", 7);
        }
        if (rf & 2) {
          let tmp_2_0;
          let tmp_4_0;
          let tmp_7_0;
          ɵɵadvance(2);
          ɵɵproperty("markers", ctx.markers());
          ɵɵadvance(3);
          ɵɵconditional((tmp_2_0 = ctx.alignmentHelper()) ? 5 : -1, tmp_2_0);
          ɵɵadvance();
          ɵɵproperty("model", ctx.connection)("template", (tmp_4_0 = ctx.connectionTemplateDirective()) == null ? null : tmp_4_0.templateRef);
          ɵɵadvance();
          ɵɵconditional(ctx.flowOptimization().detachedGroupsLayer ? 7 : -1);
          ɵɵadvance();
          ɵɵconditional(!ctx.flowOptimization().detachedGroupsLayer ? 8 : -1);
          ɵɵadvance();
          ɵɵconditional((tmp_7_0 = ctx.minimap()) ? 9 : -1, tmp_7_0);
          ɵɵadvance();
          ɵɵconditional(ctx.flowOptimization().virtualization ? 10 : -1);
        }
      },
      dependencies: [RootSvgReferenceDirective, RootSvgContextDirective, RootPointerDirective, FlowSizeControllerDirective, DefsComponent, BackgroundComponent, MapContextDirective, SpacePointContextDirective, ConnectionComponent, NodeComponent, EdgeComponent, NgTemplateOutlet, PreviewFlowComponent, AlignmentHelperComponent],
      styles: ["[_nghost-%COMP%]{display:grid;grid-template-columns:1fr;width:100%;height:100%;-webkit-user-select:none;user-select:none}[_nghost-%COMP%]     *{box-sizing:border-box}.root-svg[_ngcontent-%COMP%]{grid-row-start:1;grid-column-start:1}.preview-flow[_ngcontent-%COMP%]{pointer-events:none;grid-row-start:1;grid-column-start:1}"],
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(VflowComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "vflow",
      changeDetection: ChangeDetectionStrategy.OnPush,
      providers: [DraggableService, ViewportService, FlowStatusService, FlowEntitiesService, NodesChangeService, EdgeChangesService, NodeRenderingService, EdgeRenderingService, SelectionService, FlowSettingsService, ComponentEventBusService, KeyboardService, OverlaysService, {
        provide: PreviewFlowRenderStrategyService,
        useClass: ViewportPreviewFlowRenderStrategyService
      }, FlowRenderingService],
      hostDirectives: [changesControllerHostDirective],
      imports: [RootSvgReferenceDirective, RootSvgContextDirective, RootPointerDirective, FlowSizeControllerDirective, DefsComponent, BackgroundComponent, MapContextDirective, SpacePointContextDirective, ConnectionComponent, NodeComponent, EdgeComponent, NgTemplateOutlet, PreviewFlowComponent, AlignmentHelperComponent],
      template: '<svg:svg #flow rootSvgRef rootSvgContext rootPointer flowSizeController class="root-svg">\n  <defs flowDefs [markers]="markers()" />\n\n  <g background />\n\n  <svg:g mapContext spacePointContext>\n    @if (alignmentHelper(); as alignmentHelper) {\n      @if (alignmentHelper === true) {\n        <svg:g alignmentHelper />\n      } @else {\n        <svg:g alignmentHelper [tolerance]="alignmentHelper.tolerance" [lineColor]="alignmentHelper.lineColor" />\n      }\n    }\n\n    <!-- Connection -->\n    <svg:g connection [model]="connection" [template]="connectionTemplateDirective()?.templateRef" />\n\n    @if (flowOptimization().detachedGroupsLayer) {\n      <!-- Groups -->\n      @for (model of groups(); track trackNodes($index, model)) {\n        <svg:g\n          node\n          [model]="model"\n          [groupNodeTemplate]="groupNodeTemplateDirective()?.templateRef"\n          [attr.transform]="model.pointTransform()" />\n      }\n      <!-- Edges  -->\n      @for (model of edgeModels(); track trackEdges($index, model)) {\n        <svg:g\n          edge\n          [model]="model"\n          [edgeTemplate]="edgeTemplateDirective()?.templateRef"\n          [edgeLabelHtmlTemplate]="edgeLabelHtmlDirective()?.templateRef" />\n      }\n      <!-- Nodes -->\n      @for (model of nonGroups(); track trackNodes($index, model)) {\n        <svg:g\n          node\n          [model]="model"\n          [nodeTemplate]="nodeTemplateDirective()?.templateRef"\n          [nodeSvgTemplate]="nodeSvgTemplateDirective()?.templateRef"\n          [attr.transform]="model.pointTransform()" />\n      }\n    }\n\n    @if (!flowOptimization().detachedGroupsLayer) {\n      <!-- Edges  -->\n      @for (model of edgeModels(); track trackEdges($index, model)) {\n        <svg:g\n          edge\n          [model]="model"\n          [edgeTemplate]="edgeTemplateDirective()?.templateRef"\n          [edgeLabelHtmlTemplate]="edgeLabelHtmlDirective()?.templateRef" />\n      }\n\n      @for (model of nodeModels(); track trackNodes($index, model)) {\n        <svg:g\n          node\n          [model]="model"\n          [nodeTemplate]="nodeTemplateDirective()?.templateRef"\n          [nodeSvgTemplate]="nodeSvgTemplateDirective()?.templateRef"\n          [groupNodeTemplate]="groupNodeTemplateDirective()?.templateRef"\n          [attr.transform]="model.pointTransform()" />\n      }\n    }\n  </svg:g>\n\n  <!-- Minimap -->\n  @if (minimap(); as minimap) {\n    <ng-container [ngTemplateOutlet]="minimap.template()" />\n  }\n</svg:svg>\n\n@if (flowOptimization().virtualization) {\n  <canvas previewFlow class="preview-flow" [width]="flowWidth()" [height]="flowHeight()"></canvas>\n}\n',
      styles: [":host{display:grid;grid-template-columns:1fr;width:100%;height:100%;-webkit-user-select:none;user-select:none}:host ::ng-deep *{box-sizing:border-box}.root-svg{grid-row-start:1;grid-column-start:1}.preview-flow{pointer-events:none;grid-row-start:1;grid-column-start:1}\n"]
    }]
  }], null, {
    view: [{
      type: Input
    }],
    minZoom: [{
      type: Input
    }],
    maxZoom: [{
      type: Input
    }],
    background: [{
      type: Input
    }],
    optimization: [{
      type: Input
    }],
    entitiesSelectable: [{
      type: Input
    }],
    keyboardShortcuts: [{
      type: Input
    }],
    connection: [{
      type: Input,
      args: [{
        transform: (settings) => new ConnectionModel(settings)
      }]
    }],
    snapGrid: [{
      type: Input
    }],
    elevateNodesOnSelect: [{
      type: Input
    }],
    elevateEdgesOnSelect: [{
      type: Input
    }],
    nodes: [{
      type: Input,
      args: [{
        required: true
      }]
    }],
    edges: [{
      type: Input
    }]
  });
})();
var DragHandleDirective = class _DragHandleDirective {
  get model() {
    return this.nodeAccessor.model();
  }
  constructor() {
    this.nodeAccessor = inject(NodeAccessorService);
    this.model.dragHandlesCount.update((count) => count + 1);
    inject(DestroyRef).onDestroy(() => {
      this.model.dragHandlesCount.update((count) => count - 1);
    });
  }
  static {
    this.ɵfac = function DragHandleDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _DragHandleDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _DragHandleDirective,
      selectors: [["", "dragHandle", ""]],
      hostAttrs: [1, "vflow-drag-handle"]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(DragHandleDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "[dragHandle]",
      host: {
        class: "vflow-drag-handle"
      }
    }]
  }], () => [], null);
})();
var SelectableDirective = class _SelectableDirective {
  constructor() {
    this.flowSettingsService = inject(FlowSettingsService);
    this.selectionService = inject(SelectionService);
    this.parentEdge = inject(EdgeComponent, {
      optional: true
    });
    this.parentNode = inject(NodeComponent, {
      optional: true
    });
    this.host = inject(ElementRef);
    this.selectOnEvent = this.getEvent$().pipe(tap(() => this.select()), takeUntilDestroyed()).subscribe();
  }
  select() {
    const entity = this.entity();
    if (entity && this.flowSettingsService.entitiesSelectable()) {
      this.selectionService.select(entity);
    }
  }
  entity() {
    if (this.parentNode) {
      return this.parentNode.model();
    } else if (this.parentEdge) {
      return this.parentEdge.model();
    }
    return null;
  }
  getEvent$() {
    return fromEvent(this.host.nativeElement, "click");
  }
  static {
    this.ɵfac = function SelectableDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _SelectableDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _SelectableDirective,
      selectors: [["", "selectable", ""]]
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(SelectableDirective, [{
    type: Directive,
    args: [{
      standalone: true,
      selector: "[selectable]"
    }]
  }], null, null);
})();
var MinimapModel = class {
  constructor() {
    this.template = signal(null);
  }
};
var MiniMapComponent = class _MiniMapComponent {
  constructor() {
    this.entitiesService = inject(FlowEntitiesService);
    this.flowSettingsService = inject(FlowSettingsService);
    this.viewportService = inject(ViewportService);
    this.injector = inject(Injector);
    this.maskColor = input(`rgba(215, 215, 215, 0.6)`);
    this.strokeColor = input(`rgb(200, 200, 200)`);
    this.position = input("bottom-right");
    this.scaleOnHover = input(false);
    this.minimap = viewChild.required("minimap");
    this.minimapOffset = 10;
    this.minimapScale = computed(() => {
      if (this.scaleOnHover()) {
        return this.hovered() ? 0.4 : 0.2;
      }
      return 0.2;
    });
    this.viewportColor = computed(() => {
      const bg = this.flowSettingsService.background();
      if (bg.type === "dots" || bg.type === "solid") {
        return bg.color ?? "#fff";
      }
      return "#fff";
    });
    this.hovered = signal(false);
    this.minimapPoint = computed(() => {
      switch (this.position()) {
        case "top-left":
          return {
            x: this.minimapOffset,
            y: this.minimapOffset
          };
        case "top-right":
          return {
            x: this.flowSettingsService.computedFlowWidth() - this.minimapWidth() - this.minimapOffset,
            y: this.minimapOffset
          };
        case "bottom-left":
          return {
            x: this.minimapOffset,
            y: this.flowSettingsService.computedFlowHeight() - this.minimapHeight() - this.minimapOffset
          };
        case "bottom-right":
          return {
            x: this.flowSettingsService.computedFlowWidth() - this.minimapWidth() - this.minimapOffset,
            y: this.flowSettingsService.computedFlowHeight() - this.minimapHeight() - this.minimapOffset
          };
      }
    });
    this.minimapWidth = computed(() => this.flowSettingsService.computedFlowWidth() * this.minimapScale());
    this.minimapHeight = computed(() => this.flowSettingsService.computedFlowHeight() * this.minimapScale());
    this.viewportTransform = computed(() => {
      const viewport = this.viewportService.readableViewport();
      let scale = 1 / viewport.zoom;
      let x = -(viewport.x * this.minimapScale()) * scale;
      x /= this.minimapScale();
      let y = -(viewport.y * this.minimapScale()) * scale;
      y /= this.minimapScale();
      scale /= this.minimapScale();
      return `translate(${x}, ${y}) scale(${scale})`;
    });
    this.boundsViewport = computed(() => {
      const nodes = this.entitiesService.nodes();
      return getViewportForBounds(getNodesBounds(nodes), this.flowSettingsService.computedFlowWidth(), this.flowSettingsService.computedFlowHeight(), -Infinity, 1.5, 0);
    });
    this.minimapTransform = computed(() => {
      const vport = this.boundsViewport();
      const x = vport.x * this.minimapScale();
      const y = vport.y * this.minimapScale();
      const scale = vport.zoom * this.minimapScale();
      return `translate(${x} ${y}) scale(${scale})`;
    });
  }
  ngOnInit() {
    const model = new MinimapModel();
    model.template.set(this.minimap());
    this.entitiesService.minimap.set(model);
  }
  trackNodes(idx, {
    rawNode
  }) {
    return rawNode;
  }
  static {
    this.ɵfac = function MiniMapComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _MiniMapComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _MiniMapComponent,
      selectors: [["mini-map"]],
      viewQuery: function MiniMapComponent_Query(rf, ctx) {
        if (rf & 1) {
          ɵɵviewQuerySignal(ctx.minimap, _c12, 5);
        }
        if (rf & 2) {
          ɵɵqueryAdvance();
        }
      },
      inputs: {
        maskColor: [1, "maskColor"],
        strokeColor: [1, "strokeColor"],
        position: [1, "position"],
        scaleOnHover: [1, "scaleOnHover"]
      },
      decls: 2,
      vars: 0,
      consts: [["minimap", ""], ["fill", "none"], [3, "mouseover", "mouseleave"], ["rx", "5", "ry", "5", 1, "default-group-node", 3, "default-group-node_selected", "stroke", "fill"], [3, "selected"], [3, "outerHTML"], ["rx", "5", "ry", "5", 1, "default-group-node"]],
      template: function MiniMapComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵtemplate(0, MiniMapComponent_ng_template_0_Template, 7, 17, "ng-template", null, 0, ɵɵtemplateRefExtractor);
        }
      },
      dependencies: [DefaultNodeComponent],
      styles: [".default-group-node[_ngcontent-%COMP%]{stroke-width:1.5px;fill-opacity:.05}.default-group-node_selected[_ngcontent-%COMP%]{stroke-width:2px}"],
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(MiniMapComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "mini-map",
      imports: [DefaultNodeComponent],
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `<ng-template #minimap>
  <svg:rect
    fill="none"
    [attr.x]="minimapPoint().x"
    [attr.y]="minimapPoint().y"
    [attr.width]="minimapWidth()"
    [attr.height]="minimapHeight()"
    [attr.stroke]="strokeColor()" />

  <svg:svg
    [attr.x]="minimapPoint().x"
    [attr.y]="minimapPoint().y"
    [attr.width]="minimapWidth()"
    [attr.height]="minimapHeight()"
    (mouseover)="hovered.set(true)"
    (mouseleave)="hovered.set(false)">
    <svg:rect [attr.width]="minimapWidth()" [attr.height]="minimapHeight()" [attr.fill]="maskColor()" />

    <svg:g [attr.transform]="minimapTransform()">
      <svg:rect
        [attr.fill]="viewportColor()"
        [attr.transform]="viewportTransform()"
        [attr.width]="minimapWidth()"
        [attr.height]="minimapHeight()" />

      @for (model of entitiesService.nodes(); track trackNodes($index, model)) {
        <ng-container>
          @if (model.rawNode.type === 'default' || model.rawNode.type === 'html-template' || model.isComponentType) {
            <svg:foreignObject
              [attr.transform]="model.pointTransform()"
              [attr.width]="model.size().width"
              [attr.height]="model.size().height">
              <default-node
                [selected]="model.selected()"
                [style.width.px]="model.size().width"
                [style.height.px]="model.size().height"
                [style.max-width.px]="model.size().width"
                [style.max-height.px]="model.size().height">
                <div [outerHTML]="model.text()"></div>
              </default-node>
            </svg:foreignObject>
          }
          @if (model.rawNode.type === 'default-group' || model.rawNode.type === 'template-group') {
            <svg:rect
              class="default-group-node"
              rx="5"
              ry="5"
              [attr.transform]="model.pointTransform()"
              [class.default-group-node_selected]="model.selected()"
              [attr.width]="model.size().width"
              [attr.height]="model.size().height"
              [style.stroke]="model.color()"
              [style.fill]="model.color()" />
          }
        </ng-container>
      }
    </svg:g>
  </svg:svg>
</ng-template>
`,
      styles: [".default-group-node{stroke-width:1.5px;fill-opacity:.05}.default-group-node_selected{stroke-width:2px}\n"]
    }]
  }], null, null);
})();
var ToolbarModel = class {
  constructor(node) {
    this.node = node;
    this.position = signal("top");
    this.template = signal(null);
    this.offset = signal(10);
    this.point = computed(() => {
      switch (this.position()) {
        case "top":
          return {
            x: this.node.size().width / 2 - this.size().width / 2,
            y: -this.size().height - this.offset()
          };
        case "bottom":
          return {
            x: this.node.size().width / 2 - this.size().width / 2,
            y: this.node.size().height + this.offset()
          };
        case "left":
          return {
            x: -this.size().width - this.offset(),
            y: this.node.size().height / 2 - this.size().height / 2
          };
        case "right":
          return {
            x: this.node.size().width + this.offset(),
            y: this.node.size().height / 2 - this.size().height / 2
          };
      }
    });
    this.transform = computed(() => `translate(${this.point().x}, ${this.point().y})`);
    this.size = signal({
      width: 0,
      height: 0
    });
  }
};
var NodeToolbarComponent = class _NodeToolbarComponent {
  constructor() {
    this.overlaysService = inject(OverlaysService);
    this.nodeService = inject(NodeAccessorService);
    this.position = input("top");
    this.toolbarContentTemplate = viewChild.required("toolbar");
    this.model = new ToolbarModel(this.nodeService.model());
    effect(() => this.model.position.set(this.position()), {
      allowSignalWrites: true
    });
  }
  ngOnInit() {
    this.model.template.set(this.toolbarContentTemplate());
    this.overlaysService.addToolbar(this.model);
  }
  ngOnDestroy() {
    this.overlaysService.removeToolbar(this.model);
  }
  static {
    this.ɵfac = function NodeToolbarComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _NodeToolbarComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _NodeToolbarComponent,
      selectors: [["node-toolbar"]],
      viewQuery: function NodeToolbarComponent_Query(rf, ctx) {
        if (rf & 1) {
          ɵɵviewQuerySignal(ctx.toolbarContentTemplate, _c13, 5);
        }
        if (rf & 2) {
          ɵɵqueryAdvance();
        }
      },
      inputs: {
        position: [1, "position"]
      },
      ngContentSelectors: _c3,
      decls: 2,
      vars: 0,
      consts: [["toolbar", ""], ["nodeToolbarWrapper", "", 1, "wrapper", 3, "model"]],
      template: function NodeToolbarComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵprojectionDef();
          ɵɵtemplate(0, NodeToolbarComponent_ng_template_0_Template, 2, 1, "ng-template", null, 0, ɵɵtemplateRefExtractor);
        }
      },
      dependencies: () => [NodeToolbarWrapperDirective],
      styles: [".wrapper[_ngcontent-%COMP%]{width:max-content}"],
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(NodeToolbarComponent, [{
    type: Component,
    args: [{
      standalone: true,
      selector: "node-toolbar",
      template: `
    <ng-template #toolbar>
      <div class="wrapper" nodeToolbarWrapper [model]="model">
        <ng-content />
      </div>
    </ng-template>
  `,
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [forwardRef(() => NodeToolbarWrapperDirective)],
      styles: [".wrapper{width:max-content}\n"]
    }]
  }], () => [], null);
})();
var NodeToolbarWrapperDirective = class _NodeToolbarWrapperDirective {
  constructor() {
    this.element = inject(ElementRef);
    this.zone = inject(NgZone);
    this.destroyRef = inject(DestroyRef);
    this.model = input.required();
  }
  ngOnInit() {
    resizable([this.element.nativeElement], this.zone).pipe(tap(() => this.setSize()), takeUntilDestroyed(this.destroyRef)).subscribe();
  }
  setSize() {
    this.model().size.set({
      width: this.element.nativeElement.clientWidth,
      height: this.element.nativeElement.clientHeight
    });
  }
  static {
    this.ɵfac = function NodeToolbarWrapperDirective_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _NodeToolbarWrapperDirective)();
    };
  }
  static {
    this.ɵdir = ɵɵdefineDirective({
      type: _NodeToolbarWrapperDirective,
      selectors: [["", "nodeToolbarWrapper", ""]],
      inputs: {
        model: [1, "model"]
      }
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(NodeToolbarWrapperDirective, [{
    type: Directive,
    args: [{
      selector: "[nodeToolbarWrapper]",
      standalone: true
    }]
  }], null, null);
})();
var CustomTemplateEdgeComponent = class _CustomTemplateEdgeComponent {
  constructor() {
    this.edge = inject(EdgeComponent);
    this.flowSettingsService = inject(FlowSettingsService);
    this.edgeRenderingService = inject(EdgeRenderingService);
    this.model = this.edge.model();
    this.context = this.model.context.$implicit;
  }
  pull() {
    if (this.flowSettingsService.elevateEdgesOnSelect()) {
      this.edgeRenderingService.pull(this.model);
    }
  }
  static {
    this.ɵfac = function CustomTemplateEdgeComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || _CustomTemplateEdgeComponent)();
    };
  }
  static {
    this.ɵcmp = ɵɵdefineComponent({
      type: _CustomTemplateEdgeComponent,
      selectors: [["g", "customTemplateEdge", ""]],
      hostBindings: function CustomTemplateEdgeComponent_HostBindings(rf, ctx) {
        if (rf & 1) {
          ɵɵlistener("mousedown", function CustomTemplateEdgeComponent_mousedown_HostBindingHandler() {
            return ctx.pull();
          })("touchstart", function CustomTemplateEdgeComponent_touchstart_HostBindingHandler() {
            return ctx.pull();
          });
        }
      },
      attrs: _c14,
      ngContentSelectors: _c3,
      decls: 3,
      vars: 1,
      consts: [["interactiveEdge", ""], [1, "interactive-edge"]],
      template: function CustomTemplateEdgeComponent_Template(rf, ctx) {
        if (rf & 1) {
          ɵɵprojectionDef();
          ɵɵprojection(0);
          ɵɵnamespaceSVG();
          ɵɵdomElement(1, "path", 1, 0);
        }
        if (rf & 2) {
          ɵɵadvance();
          ɵɵattribute("d", ctx.context.path());
        }
      },
      styles: [".interactive-edge[_ngcontent-%COMP%]{fill:none;stroke-width:20;stroke:transparent}"],
      changeDetection: 0
    });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(CustomTemplateEdgeComponent, [{
    type: Component,
    args: [{
      selector: "g[customTemplateEdge]",
      changeDetection: ChangeDetectionStrategy.OnPush,
      standalone: true,
      host: {
        "(mousedown)": "pull()",
        "(touchstart)": "pull()"
      },
      template: '<ng-content />\n\n<svg:path #interactiveEdge class="interactive-edge" [attr.d]="context.path()" />\n',
      styles: [".interactive-edge{fill:none;stroke-width:20;stroke:transparent}\n"]
    }]
  }], null, null);
})();
var Vflow = [VflowComponent, HandleComponent, ResizableComponent, SelectableDirective, MiniMapComponent, NodeToolbarComponent, CustomTemplateEdgeComponent, DragHandleDirective, ConnectionControllerDirective, NodeHtmlTemplateDirective, NodeSvgTemplateDirective, GroupNodeTemplateDirective, EdgeLabelHtmlTemplateDirective, EdgeTemplateDirective, ConnectionTemplateDirective, HandleTemplateDirective];
export {
  ChangesControllerDirective,
  ConnectionControllerDirective,
  ConnectionTemplateDirective,
  CustomDynamicNodeComponent,
  CustomNodeComponent,
  CustomTemplateEdgeComponent,
  DEFAULT_OPTIMIZATION,
  DragHandleDirective,
  EdgeLabelHtmlTemplateDirective,
  EdgeTemplateDirective,
  GroupNodeTemplateDirective,
  HandleComponent,
  HandleTemplateDirective,
  MiniMapComponent,
  NodeHtmlTemplateDirective,
  NodeSvgTemplateDirective,
  NodeToolbarComponent,
  NodeToolbarWrapperDirective,
  ResizableComponent,
  SelectableDirective,
  Vflow,
  VflowComponent,
  isComponentDynamicNode,
  isComponentStaticNode,
  isDefaultDynamicGroupNode,
  isDefaultDynamicNode,
  isDefaultStaticGroupNode,
  isDefaultStaticNode,
  isDynamicNode,
  isStaticNode,
  isSvgTemplateDynamicNode,
  isSvgTemplateStaticNode,
  isTemplateDynamicGroupNode,
  isTemplateDynamicNode,
  isTemplateStaticGroupNode,
  isTemplateStaticNode,
  ComponentEventBusService as ɵComponentEventBusService,
  ConnectionModel as ɵConnectionModel,
  FlowEntitiesService as ɵFlowEntitiesService,
  FlowSettingsService as ɵFlowSettingsService,
  HandleModel as ɵHandleModel,
  HandleService as ɵHandleService,
  NodeAccessorService as ɵNodeAccessorService,
  NodeModel as ɵNodeModel,
  NodeRenderingService as ɵNodeRenderingService,
  RootPointerDirective as ɵRootPointerDirective,
  SelectionService as ɵSelectionService,
  SpacePointContextDirective as ɵSpacePointContextDirective,
  ViewportService as ɵViewportService
};
//# sourceMappingURL=ngx-vflow.js.map
