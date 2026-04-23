import {
  DynamicComponent,
  Renderer
} from "./chunk-LE62UOP7.js";
import "./chunk-KECT6LAV.js";
import "./chunk-5YSMMLC5.js";
import "./chunk-A7FRXOSW.js";
import "./chunk-PEEADQSW.js";
import "./chunk-Y6THCRK5.js";
import "./chunk-TREOF22W.js";
import {
  Component,
  Input,
  input,
  setClassMetadata,
  ɵɵInheritDefinitionFeature,
  ɵɵadvance,
  ɵɵattribute,
  ɵɵclassMap,
  ɵɵdefineComponent,
  ɵɵelementContainer,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetInheritedFactory,
  ɵɵnextContext,
  ɵɵproperty,
  ɵɵrepeater,
  ɵɵrepeaterCreate,
  ɵɵrepeaterTrackByIdentity,
  ɵɵstyleMap
} from "./chunk-A2DGQQFJ.js";
import "./chunk-ZIK34A2Q.js";
import "./chunk-SN3C37HS.js";
import "./chunk-IYAMKWW5.js";
import "./chunk-QZRS5QDR.js";
import "./chunk-YSYTNXRR.js";
import "./chunk-IZIF4DQH.js";

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-list-nEeT59V3.mjs
function List_For_2_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵelementContainer(0, 0);
  }
  if (rf & 2) {
    const child_r1 = ctx.$implicit;
    const ctx_r1 = ɵɵnextContext();
    ɵɵproperty("surfaceId", ctx_r1.surfaceId())("component", child_r1);
  }
}
var List = class _List extends DynamicComponent {
  direction = input("vertical", ...ngDevMode ? [{
    debugName: "direction"
  }] : []);
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵList_BaseFactory;
    return function List_Factory(__ngFactoryType__) {
      return (ɵList_BaseFactory || (ɵList_BaseFactory = ɵɵgetInheritedFactory(_List)))(__ngFactoryType__ || _List);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _List,
    selectors: [["a2ui-list"]],
    hostVars: 1,
    hostBindings: function List_HostBindings(rf, ctx) {
      if (rf & 2) {
        ɵɵattribute("direction", ctx.direction());
      }
    },
    inputs: {
      direction: [1, "direction"]
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 3,
    vars: 4,
    consts: [["a2ui-renderer", "", 3, "surfaceId", "component"]],
    template: function List_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵelementStart(0, "section");
        ɵɵrepeaterCreate(1, List_For_2_Template, 1, 2, "ng-container", 0, ɵɵrepeaterTrackByIdentity);
        ɵɵelementEnd();
      }
      if (rf & 2) {
        ɵɵstyleMap(ctx.theme.additionalStyles == null ? null : ctx.theme.additionalStyles.List);
        ɵɵclassMap(ctx.theme.components.List);
        ɵɵadvance();
        ɵɵrepeater(ctx.component().properties.children);
      }
    },
    dependencies: [Renderer],
    styles: ['[_nghost-%COMP%]{display:block;flex:var(--weight);min-height:0;overflow:auto}[direction="vertical"][_nghost-%COMP%]   section[_ngcontent-%COMP%]{display:grid}[direction="horizontal"][_nghost-%COMP%]   section[_ngcontent-%COMP%]{display:flex;max-width:100%;overflow-x:scroll;overflow-y:hidden;scrollbar-width:none}[direction="horizontal"][_nghost-%COMP%]   section[_ngcontent-%COMP%] > [_ngcontent-%COMP%]::slotted(*){flex:1 0 fit-content;max-width:min(80%,400px)}']
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(List, [{
    type: Component,
    args: [{
      selector: "a2ui-list",
      imports: [Renderer],
      host: {
        "[attr.direction]": "direction()"
      },
      template: `
    <section [class]="theme.components.List" [style]="theme.additionalStyles?.List">
      @for (child of component().properties.children; track child) {
        <ng-container a2ui-renderer [surfaceId]="surfaceId()!" [component]="child" />
      }
    </section>
  `,
      styles: [':host{display:block;flex:var(--weight);min-height:0;overflow:auto}:host([direction="vertical"]) section{display:grid}:host([direction="horizontal"]) section{display:flex;max-width:100%;overflow-x:scroll;overflow-y:hidden;scrollbar-width:none}:host([direction="horizontal"]) section>::slotted(*){flex:1 0 fit-content;max-width:min(80%,400px)}\n']
    }]
  }], null, {
    direction: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "direction",
        required: false
      }]
    }]
  });
})();
export {
  List
};
//# sourceMappingURL=a2ui-angular-list-nEeT59V3-WQOMJRKJ.js.map
