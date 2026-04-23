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

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-audio-DoZb9mn_.mjs
function Audio_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵdomElementStart(0, "section");
    ɵɵdomElement(1, "audio", 1);
    ɵɵdomElementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext();
    const resolvedUrl_r2 = ɵɵreadContextLet(0);
    ɵɵstyleMap(ctx_r0.theme.additionalStyles == null ? null : ctx_r0.theme.additionalStyles.AudioPlayer);
    ɵɵclassMap(ctx_r0.theme.components.AudioPlayer);
    ɵɵadvance();
    ɵɵdomProperty("src", resolvedUrl_r2);
  }
}
var Audio = class _Audio extends DynamicComponent {
  url = input.required(...ngDevMode ? [{
    debugName: "url"
  }] : []);
  resolvedUrl = computed(() => this.resolvePrimitive(this.url()), ...ngDevMode ? [{
    debugName: "resolvedUrl"
  }] : []);
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵAudio_BaseFactory;
    return function Audio_Factory(__ngFactoryType__) {
      return (ɵAudio_BaseFactory || (ɵAudio_BaseFactory = ɵɵgetInheritedFactory(_Audio)))(__ngFactoryType__ || _Audio);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _Audio,
    selectors: [["a2ui-audio"]],
    inputs: {
      url: [1, "url"]
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 2,
    vars: 2,
    consts: [[3, "class", "style"], ["controls", "", 3, "src"]],
    template: function Audio_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵdeclareLet(0);
        ɵɵconditionalCreate(1, Audio_Conditional_1_Template, 2, 5, "section", 0);
      }
      if (rf & 2) {
        const resolvedUrl_r3 = ɵɵstoreLet(ctx.resolvedUrl());
        ɵɵadvance();
        ɵɵconditional(resolvedUrl_r3 ? 1 : -1);
      }
    },
    styles: ["[_nghost-%COMP%]{display:block;flex:var(--weight);min-height:0;overflow:auto}audio[_ngcontent-%COMP%]{display:block;width:100%;box-sizing:border-box}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Audio, [{
    type: Component,
    args: [{
      selector: "a2ui-audio",
      template: `
    @let resolvedUrl = this.resolvedUrl();

    @if (resolvedUrl) {
      <section [class]="theme.components.AudioPlayer" [style]="theme.additionalStyles?.AudioPlayer">
        <audio controls [src]="resolvedUrl"></audio>
      </section>
    }
  `,
      styles: [":host{display:block;flex:var(--weight);min-height:0;overflow:auto}audio{display:block;width:100%;box-sizing:border-box}\n"]
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
  Audio
};
//# sourceMappingURL=a2ui-angular-audio-DoZb9mn_-BFQ54Q6Z.js.map
