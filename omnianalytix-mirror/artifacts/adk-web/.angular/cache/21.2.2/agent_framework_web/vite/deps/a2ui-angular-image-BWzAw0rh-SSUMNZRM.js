import {
  DynamicComponent
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
  ɵɵconditional,
  ɵɵconditionalCreate,
  ɵɵdeclareLet,
  ɵɵdefineComponent,
  ɵɵdomElement,
  ɵɵdomElementEnd,
  ɵɵdomElementStart,
  ɵɵdomProperty,
  ɵɵgetInheritedFactory,
  ɵɵnextContext,
  ɵɵreadContextLet,
  ɵɵsanitizeUrl,
  ɵɵstoreLet,
  ɵɵstyleMap
} from "./chunk-A2DGQQFJ.js";
import {
  computed
} from "./chunk-ZIK34A2Q.js";
import "./chunk-SN3C37HS.js";
import "./chunk-IYAMKWW5.js";
import "./chunk-QZRS5QDR.js";
import "./chunk-YSYTNXRR.js";
import "./chunk-IZIF4DQH.js";

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-image-BWzAw0rh.mjs
function Image_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵdomElementStart(0, "section");
    ɵɵdomElement(1, "img", 1);
    ɵɵdomElementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext();
    const resolvedUrl_r2 = ɵɵreadContextLet(0);
    ɵɵstyleMap(ctx_r0.theme.additionalStyles == null ? null : ctx_r0.theme.additionalStyles.Image);
    ɵɵclassMap(ctx_r0.classes());
    ɵɵadvance();
    ɵɵdomProperty("src", resolvedUrl_r2, ɵɵsanitizeUrl);
  }
}
var Image = class _Image extends DynamicComponent {
  url = input.required(...ngDevMode ? [{
    debugName: "url"
  }] : []);
  usageHint = input.required(...ngDevMode ? [{
    debugName: "usageHint"
  }] : []);
  resolvedUrl = computed(() => this.resolvePrimitive(this.url()), ...ngDevMode ? [{
    debugName: "resolvedUrl"
  }] : []);
  classes = computed(() => {
    const usageHint = this.usageHint();
    return styles_exports.merge(this.theme.components.Image.all, usageHint ? this.theme.components.Image[usageHint] : {});
  }, ...ngDevMode ? [{
    debugName: "classes"
  }] : []);
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵImage_BaseFactory;
    return function Image_Factory(__ngFactoryType__) {
      return (ɵImage_BaseFactory || (ɵImage_BaseFactory = ɵɵgetInheritedFactory(_Image)))(__ngFactoryType__ || _Image);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _Image,
    selectors: [["a2ui-image"]],
    inputs: {
      url: [1, "url"],
      usageHint: [1, "usageHint"]
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 2,
    vars: 2,
    consts: [[3, "class", "style"], [3, "src"]],
    template: function Image_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵdeclareLet(0);
        ɵɵconditionalCreate(1, Image_Conditional_1_Template, 2, 5, "section", 0);
      }
      if (rf & 2) {
        const resolvedUrl_r3 = ɵɵstoreLet(ctx.resolvedUrl());
        ɵɵadvance();
        ɵɵconditional(resolvedUrl_r3 ? 1 : -1);
      }
    },
    styles: ["[_nghost-%COMP%]{display:block;flex:var(--weight);min-height:0;overflow:auto}img[_ngcontent-%COMP%]{display:block;width:100%;height:100%;box-sizing:border-box}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Image, [{
    type: Component,
    args: [{
      selector: "a2ui-image",
      template: `
    @let resolvedUrl = this.resolvedUrl();

    @if (resolvedUrl) {
      <section [class]="classes()" [style]="theme.additionalStyles?.Image">
        <img [src]="resolvedUrl" />
      </section>
    }
  `,
      styles: [":host{display:block;flex:var(--weight);min-height:0;overflow:auto}img{display:block;width:100%;height:100%;box-sizing:border-box}\n"]
    }]
  }], null, {
    url: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "url",
        required: true
      }]
    }],
    usageHint: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "usageHint",
        required: true
      }]
    }]
  });
})();
export {
  Image
};
//# sourceMappingURL=a2ui-angular-image-BWzAw0rh-SSUMNZRM.js.map
