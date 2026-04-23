import {
  DynamicComponent,
  Renderer
} from "./chunk-LE62UOP7.js";
import "./chunk-KECT6LAV.js";
import "./chunk-5YSMMLC5.js";
import "./chunk-A7FRXOSW.js";
import {
  styles_exports
} from "./chunk-PEEADQSW.js";
import "./chunk-Y6THCRK5.js";
import "./chunk-TREOF22W.js";
import {
  Component,
  Input,
  input,
  setClassMetadata,
  ɵɵInheritDefinitionFeature,
  ɵɵadvance,
  ɵɵclassMap,
  ɵɵdeclareLet,
  ɵɵdefineComponent,
  ɵɵelementContainer,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵgetInheritedFactory,
  ɵɵlistener,
  ɵɵnextContext,
  ɵɵproperty,
  ɵɵreadContextLet,
  ɵɵrepeater,
  ɵɵrepeaterCreate,
  ɵɵrepeaterTrackByIdentity,
  ɵɵstoreLet,
  ɵɵstyleMap,
  ɵɵtext,
  ɵɵtextInterpolate1
} from "./chunk-A2DGQQFJ.js";
import {
  computed,
  signal,
  ɵɵresetView,
  ɵɵrestoreView
} from "./chunk-ZIK34A2Q.js";
import "./chunk-SN3C37HS.js";
import "./chunk-IYAMKWW5.js";
import "./chunk-QZRS5QDR.js";
import "./chunk-YSYTNXRR.js";
import "./chunk-IZIF4DQH.js";

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-tabs-q5Mn9vgq.mjs
function Tabs_For_4_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = ɵɵgetCurrentView();
    ɵɵelementStart(0, "button", 2);
    ɵɵlistener("click", function Tabs_For_4_Template_button_click_0_listener() {
      const $index_r2 = ɵɵrestoreView(_r1).$index;
      const ctx_r2 = ɵɵnextContext();
      return ɵɵresetView(ctx_r2.selectedIndex.set($index_r2));
    });
    ɵɵtext(1);
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const tab_r4 = ctx.$implicit;
    const $index_r2 = ctx.$index;
    const ctx_r2 = ɵɵnextContext();
    const selectedIndex_r5 = ɵɵreadContextLet(0);
    ɵɵclassMap(ctx_r2.buttonClasses()[selectedIndex_r5]);
    ɵɵproperty("disabled", selectedIndex_r5 === $index_r2);
    ɵɵadvance();
    ɵɵtextInterpolate1(" ", ctx_r2.resolvePrimitive(tab_r4.title), " ");
  }
}
var Tabs = class _Tabs extends DynamicComponent {
  selectedIndex = signal(0, ...ngDevMode ? [{
    debugName: "selectedIndex"
  }] : []);
  tabs = input.required(...ngDevMode ? [{
    debugName: "tabs"
  }] : []);
  buttonClasses = computed(() => {
    const selectedIndex = this.selectedIndex();
    return this.tabs().map((_, index) => {
      return index === selectedIndex ? styles_exports.merge(this.theme.components.Tabs.controls.all, this.theme.components.Tabs.controls.selected) : this.theme.components.Tabs.controls.all;
    });
  }, ...ngDevMode ? [{
    debugName: "buttonClasses"
  }] : []);
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵTabs_BaseFactory;
    return function Tabs_Factory(__ngFactoryType__) {
      return (ɵTabs_BaseFactory || (ɵTabs_BaseFactory = ɵɵgetInheritedFactory(_Tabs)))(__ngFactoryType__ || _Tabs);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _Tabs,
    selectors: [["a2ui-tabs"]],
    inputs: {
      tabs: [1, "tabs"]
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 6,
    vars: 9,
    consts: [[3, "disabled", "class"], ["a2ui-renderer", "", 3, "surfaceId", "component"], [3, "click", "disabled"]],
    template: function Tabs_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵdeclareLet(0);
        ɵɵelementStart(1, "section")(2, "div");
        ɵɵrepeaterCreate(3, Tabs_For_4_Template, 2, 4, "button", 0, ɵɵrepeaterTrackByIdentity);
        ɵɵelementEnd();
        ɵɵelementContainer(5, 1);
        ɵɵelementEnd();
      }
      if (rf & 2) {
        const tabs_r6 = ctx.tabs();
        const selectedIndex_r7 = ɵɵstoreLet(ctx.selectedIndex());
        ɵɵadvance();
        ɵɵstyleMap(ctx.theme.additionalStyles == null ? null : ctx.theme.additionalStyles.Tabs);
        ɵɵclassMap(ctx.theme.components.Tabs.container);
        ɵɵadvance();
        ɵɵclassMap(ctx.theme.components.Tabs.element);
        ɵɵadvance();
        ɵɵrepeater(tabs_r6);
        ɵɵadvance(2);
        ɵɵproperty("surfaceId", ctx.surfaceId())("component", tabs_r6[selectedIndex_r7].child);
      }
    },
    dependencies: [Renderer],
    styles: ["[_nghost-%COMP%]{display:block;flex:var(--weight)}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Tabs, [{
    type: Component,
    args: [{
      selector: "a2ui-tabs",
      imports: [Renderer],
      template: `
    @let tabs = this.tabs();
    @let selectedIndex = this.selectedIndex();

    <section [class]="theme.components.Tabs.container" [style]="theme.additionalStyles?.Tabs">
      <div [class]="theme.components.Tabs.element">
        @for (tab of tabs; track tab) {
          <button
            (click)="this.selectedIndex.set($index)"
            [disabled]="selectedIndex === $index"
            [class]="buttonClasses()[selectedIndex]"
          >
            {{ resolvePrimitive(tab.title) }}
          </button>
        }
      </div>

      <ng-container
        a2ui-renderer
        [surfaceId]="surfaceId()!"
        [component]="tabs[selectedIndex].child"
      />
    </section>
  `,
      styles: [":host{display:block;flex:var(--weight)}\n"]
    }]
  }], null, {
    tabs: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "tabs",
        required: true
      }]
    }]
  });
})();
export {
  Tabs
};
//# sourceMappingURL=a2ui-angular-tabs-q5Mn9vgq-YO4MHZHM.js.map
