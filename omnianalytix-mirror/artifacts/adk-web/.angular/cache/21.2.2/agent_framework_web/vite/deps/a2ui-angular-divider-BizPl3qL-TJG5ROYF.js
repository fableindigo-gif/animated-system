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
  setClassMetadata,
  ɵɵInheritDefinitionFeature,
  ɵɵclassMap,
  ɵɵdefineComponent,
  ɵɵdomElement,
  ɵɵgetInheritedFactory,
  ɵɵstyleMap
} from "./chunk-A2DGQQFJ.js";
import "./chunk-ZIK34A2Q.js";
import "./chunk-SN3C37HS.js";
import "./chunk-IYAMKWW5.js";
import "./chunk-QZRS5QDR.js";
import "./chunk-YSYTNXRR.js";
import "./chunk-IZIF4DQH.js";

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-divider-BizPl3qL.mjs
var Divider = class _Divider extends DynamicComponent {
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵDivider_BaseFactory;
    return function Divider_Factory(__ngFactoryType__) {
      return (ɵDivider_BaseFactory || (ɵDivider_BaseFactory = ɵɵgetInheritedFactory(_Divider)))(__ngFactoryType__ || _Divider);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _Divider,
    selectors: [["a2ui-divider"]],
    features: [ɵɵInheritDefinitionFeature],
    decls: 1,
    vars: 4,
    template: function Divider_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵdomElement(0, "hr");
      }
      if (rf & 2) {
        ɵɵstyleMap(ctx.theme.additionalStyles == null ? null : ctx.theme.additionalStyles.Divider);
        ɵɵclassMap(ctx.theme.components.Divider);
      }
    },
    styles: ["[_nghost-%COMP%]{display:block;min-height:0;overflow:auto}hr[_ngcontent-%COMP%]{height:1px;background:#ccc;border:none}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Divider, [{
    type: Component,
    args: [{
      selector: "a2ui-divider",
      template: '<hr [class]="theme.components.Divider" [style]="theme.additionalStyles?.Divider"/>',
      styles: [":host{display:block;min-height:0;overflow:auto}hr{height:1px;background:#ccc;border:none}\n"]
    }]
  }], null, null);
})();
export {
  Divider
};
//# sourceMappingURL=a2ui-angular-divider-BizPl3qL-TJG5ROYF.js.map
