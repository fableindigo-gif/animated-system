import {
  DynamicComponent
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
  ɵɵclassMap,
  ɵɵconditional,
  ɵɵconditionalCreate,
  ɵɵdeclareLet,
  ɵɵdefineComponent,
  ɵɵdomElementEnd,
  ɵɵdomElementStart,
  ɵɵgetInheritedFactory,
  ɵɵnextContext,
  ɵɵreadContextLet,
  ɵɵstoreLet,
  ɵɵstyleMap,
  ɵɵtext,
  ɵɵtextInterpolate
} from "./chunk-A2DGQQFJ.js";
import {
  computed
} from "./chunk-ZIK34A2Q.js";
import "./chunk-SN3C37HS.js";
import "./chunk-IYAMKWW5.js";
import "./chunk-QZRS5QDR.js";
import "./chunk-YSYTNXRR.js";
import "./chunk-IZIF4DQH.js";

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-icon-BE9Hj9V6.mjs
function Icon_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵdomElementStart(0, "section")(1, "span", 1);
    ɵɵtext(2);
    ɵɵdomElementEnd()();
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext();
    const resolvedName_r2 = ɵɵreadContextLet(0);
    ɵɵstyleMap(ctx_r0.theme.additionalStyles == null ? null : ctx_r0.theme.additionalStyles.Icon);
    ɵɵclassMap(ctx_r0.theme.components.Icon);
    ɵɵadvance(2);
    ɵɵtextInterpolate(resolvedName_r2);
  }
}
var Icon = class _Icon extends DynamicComponent {
  name = input.required(...ngDevMode ? [{
    debugName: "name"
  }] : []);
  resolvedName = computed(() => this.resolvePrimitive(this.name()), ...ngDevMode ? [{
    debugName: "resolvedName"
  }] : []);
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵIcon_BaseFactory;
    return function Icon_Factory(__ngFactoryType__) {
      return (ɵIcon_BaseFactory || (ɵIcon_BaseFactory = ɵɵgetInheritedFactory(_Icon)))(__ngFactoryType__ || _Icon);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _Icon,
    selectors: [["a2ui-icon"]],
    inputs: {
      name: [1, "name"]
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 2,
    vars: 2,
    consts: [[3, "class", "style"], [1, "g-icon"]],
    template: function Icon_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵdeclareLet(0);
        ɵɵconditionalCreate(1, Icon_Conditional_1_Template, 3, 5, "section", 0);
      }
      if (rf & 2) {
        const resolvedName_r3 = ɵɵstoreLet(ctx.resolvedName());
        ɵɵadvance();
        ɵɵconditional(resolvedName_r3 ? 1 : -1);
      }
    },
    styles: ["[_nghost-%COMP%]{display:block;flex:var(--weight);min-height:0;overflow:auto}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Icon, [{
    type: Component,
    args: [{
      selector: "a2ui-icon",
      template: `
    @let resolvedName = this.resolvedName();

    @if (resolvedName) {
      <section [class]="theme.components.Icon" [style]="theme.additionalStyles?.Icon">
        <span class="g-icon">{{ resolvedName }}</span>
      </section>
    }
  `,
      styles: [":host{display:block;flex:var(--weight);min-height:0;overflow:auto}\n"]
    }]
  }], null, {
    name: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "name",
        required: true
      }]
    }]
  });
})();
export {
  Icon
};
//# sourceMappingURL=a2ui-angular-icon-BE9Hj9V6-PNGYIVKH.js.map
