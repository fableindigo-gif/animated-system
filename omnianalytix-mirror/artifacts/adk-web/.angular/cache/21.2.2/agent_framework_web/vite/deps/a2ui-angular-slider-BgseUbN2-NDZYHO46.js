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
  ɵɵdefineComponent,
  ɵɵdomElementEnd,
  ɵɵdomElementStart,
  ɵɵdomListener,
  ɵɵdomProperty,
  ɵɵgetInheritedFactory,
  ɵɵstyleMap,
  ɵɵtext,
  ɵɵtextInterpolate1
} from "./chunk-A2DGQQFJ.js";
import {
  computed
} from "./chunk-ZIK34A2Q.js";
import "./chunk-SN3C37HS.js";
import "./chunk-IYAMKWW5.js";
import "./chunk-QZRS5QDR.js";
import "./chunk-YSYTNXRR.js";
import "./chunk-IZIF4DQH.js";

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-slider-BgseUbN2.mjs
var _c0 = ["a2ui-slider", ""];
var Slider = class _Slider extends DynamicComponent {
  value = input.required(...ngDevMode ? [{
    debugName: "value"
  }] : []);
  label = input("", ...ngDevMode ? [{
    debugName: "label"
  }] : []);
  minValue = input.required(...ngDevMode ? [{
    debugName: "minValue"
  }] : []);
  maxValue = input.required(...ngDevMode ? [{
    debugName: "maxValue"
  }] : []);
  inputId = super.getUniqueId("a2ui-slider");
  resolvedValue = computed(() => super.resolvePrimitive(this.value()) ?? 0, ...ngDevMode ? [{
    debugName: "resolvedValue"
  }] : []);
  handleInput(event) {
    const path = this.value()?.path;
    if (!(event.target instanceof HTMLInputElement) || !path) {
      return;
    }
    this.processor.setData(this.component(), path, event.target.valueAsNumber, this.surfaceId());
  }
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵSlider_BaseFactory;
    return function Slider_Factory(__ngFactoryType__) {
      return (ɵSlider_BaseFactory || (ɵSlider_BaseFactory = ɵɵgetInheritedFactory(_Slider)))(__ngFactoryType__ || _Slider);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _Slider,
    selectors: [["", "a2ui-slider", ""]],
    inputs: {
      value: [1, "value"],
      label: [1, "label"],
      minValue: [1, "minValue"],
      maxValue: [1, "maxValue"]
    },
    features: [ɵɵInheritDefinitionFeature],
    attrs: _c0,
    decls: 4,
    vars: 14,
    consts: [[3, "for"], ["autocomplete", "off", "type", "range", 3, "input", "value", "min", "max", "id"]],
    template: function Slider_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵdomElementStart(0, "section")(1, "label", 0);
        ɵɵtext(2);
        ɵɵdomElementEnd();
        ɵɵdomElementStart(3, "input", 1);
        ɵɵdomListener("input", function Slider_Template_input_input_3_listener($event) {
          return ctx.handleInput($event);
        });
        ɵɵdomElementEnd()();
      }
      if (rf & 2) {
        ɵɵclassMap(ctx.theme.components.Slider.container);
        ɵɵadvance();
        ɵɵclassMap(ctx.theme.components.Slider.label);
        ɵɵdomProperty("htmlFor", ctx.inputId);
        ɵɵadvance();
        ɵɵtextInterpolate1(" ", ctx.label(), " ");
        ɵɵadvance();
        ɵɵstyleMap(ctx.theme.additionalStyles == null ? null : ctx.theme.additionalStyles.Slider);
        ɵɵclassMap(ctx.theme.components.Slider.element);
        ɵɵdomProperty("value", ctx.resolvedValue())("min", ctx.minValue())("max", ctx.maxValue())("id", ctx.inputId);
      }
    },
    styles: ["[_nghost-%COMP%]{display:block;flex:var(--weight)}input[_ngcontent-%COMP%]{display:block;width:100%;box-sizing:border-box}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Slider, [{
    type: Component,
    args: [{
      selector: "[a2ui-slider]",
      template: `
    <section [class]="theme.components.Slider.container">
      <label [class]="theme.components.Slider.label" [for]="inputId">
        {{ label() }}
      </label>

      <input
        autocomplete="off"
        type="range"
        [value]="resolvedValue()"
        [min]="minValue()"
        [max]="maxValue()"
        [id]="inputId"
        (input)="handleInput($event)"
        [class]="theme.components.Slider.element"
        [style]="theme.additionalStyles?.Slider"
      />
    </section>
  `,
      styles: [":host{display:block;flex:var(--weight)}input{display:block;width:100%;box-sizing:border-box}\n"]
    }]
  }], null, {
    value: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "value",
        required: true
      }]
    }],
    label: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "label",
        required: false
      }]
    }],
    minValue: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "minValue",
        required: true
      }]
    }],
    maxValue: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "maxValue",
        required: true
      }]
    }]
  });
})();
export {
  Slider
};
//# sourceMappingURL=a2ui-angular-slider-BgseUbN2-NDZYHO46.js.map
