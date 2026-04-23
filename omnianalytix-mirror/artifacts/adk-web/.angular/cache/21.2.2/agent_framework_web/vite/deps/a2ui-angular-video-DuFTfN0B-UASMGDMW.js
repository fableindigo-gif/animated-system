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

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-video-DuFTfN0B.mjs
function Video_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵdomElementStart(0, "section");
    ɵɵdomElement(1, "video", 1);
    ɵɵdomElementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext();
    const resolvedUrl_r2 = ɵɵreadContextLet(0);
    ɵɵstyleMap(ctx_r0.theme.additionalStyles == null ? null : ctx_r0.theme.additionalStyles.Video);
    ɵɵclassMap(ctx_r0.theme.components.Video);
    ɵɵadvance();
    ɵɵdomProperty("src", resolvedUrl_r2, ɵɵsanitizeUrl);
  }
}
var Video = class _Video extends DynamicComponent {
  url = input.required(...ngDevMode ? [{
    debugName: "url"
  }] : []);
  resolvedUrl = computed(() => this.resolvePrimitive(this.url()), ...ngDevMode ? [{
    debugName: "resolvedUrl"
  }] : []);
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵVideo_BaseFactory;
    return function Video_Factory(__ngFactoryType__) {
      return (ɵVideo_BaseFactory || (ɵVideo_BaseFactory = ɵɵgetInheritedFactory(_Video)))(__ngFactoryType__ || _Video);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _Video,
    selectors: [["a2ui-video"]],
    inputs: {
      url: [1, "url"]
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 2,
    vars: 2,
    consts: [[3, "class", "style"], ["controls", "", 3, "src"]],
    template: function Video_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵdeclareLet(0);
        ɵɵconditionalCreate(1, Video_Conditional_1_Template, 2, 5, "section", 0);
      }
      if (rf & 2) {
        const resolvedUrl_r3 = ɵɵstoreLet(ctx.resolvedUrl());
        ɵɵadvance();
        ɵɵconditional(resolvedUrl_r3 ? 1 : -1);
      }
    },
    styles: ["[_nghost-%COMP%]{display:block;flex:var(--weight);min-height:0;overflow:auto}video[_ngcontent-%COMP%]{display:block;width:100%;box-sizing:border-box}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Video, [{
    type: Component,
    args: [{
      selector: "a2ui-video",
      template: `
    @let resolvedUrl = this.resolvedUrl();

    @if (resolvedUrl) {
      <section [class]="theme.components.Video" [style]="theme.additionalStyles?.Video">
        <video controls [src]="resolvedUrl"></video>
      </section>
    }
  `,
      styles: [":host{display:block;flex:var(--weight);min-height:0;overflow:auto}video{display:block;width:100%;box-sizing:border-box}\n"]
    }]
  }], null, {
    url: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "url",
        required: true
      }]
    }]
  });
})();
export {
  Video
};
//# sourceMappingURL=a2ui-angular-video-DuFTfN0B-UASMGDMW.js.map
