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
  ɵɵattribute,
  ɵɵclassMap,
  ɵɵdefineComponent,
  ɵɵdomElementEnd,
  ɵɵdomElementStart,
  ɵɵdomListener,
  ɵɵdomProperty,
  ɵɵgetInheritedFactory,
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

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-datetime-input-dmZAjvrF.mjs
var DatetimeInput = class _DatetimeInput extends DynamicComponent {
  value = input.required(...ngDevMode ? [{
    debugName: "value"
  }] : []);
  enableDate = input.required(...ngDevMode ? [{
    debugName: "enableDate"
  }] : []);
  enableTime = input.required(...ngDevMode ? [{
    debugName: "enableTime"
  }] : []);
  inputId = super.getUniqueId("a2ui-datetime-input");
  inputType = computed(() => {
    const enableDate = this.enableDate();
    const enableTime = this.enableTime();
    if (enableDate && enableTime) {
      return "datetime-local";
    } else if (enableDate) {
      return "date";
    } else if (enableTime) {
      return "time";
    }
    return "datetime-local";
  }, ...ngDevMode ? [{
    debugName: "inputType"
  }] : []);
  label = computed(() => {
    const inputType = this.inputType();
    if (inputType === "date") {
      return "Date";
    } else if (inputType === "time") {
      return "Time";
    }
    return "Date & Time";
  }, ...ngDevMode ? [{
    debugName: "label"
  }] : []);
  inputValue = computed(() => {
    const inputType = this.inputType();
    const parsed = super.resolvePrimitive(this.value()) || "";
    const date = parsed ? new Date(parsed) : null;
    if (!date || isNaN(date.getTime())) {
      return "";
    }
    const year = this.padNumber(date.getFullYear());
    const month = this.padNumber(date.getMonth());
    const day = this.padNumber(date.getDate());
    const hours = this.padNumber(date.getHours());
    const minutes = this.padNumber(date.getMinutes());
    if (inputType === "date") {
      return `${year}-${month}-${day}`;
    } else if (inputType === "time") {
      return `${hours}:${minutes}`;
    }
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }, ...ngDevMode ? [{
    debugName: "inputValue"
  }] : []);
  handleInput(event) {
    const path = this.value()?.path;
    if (!(event.target instanceof HTMLInputElement) || !path) {
      return;
    }
    this.processor.setData(this.component(), path, event.target.value, this.surfaceId());
  }
  padNumber(value) {
    return value.toString().padStart(2, "0");
  }
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵDatetimeInput_BaseFactory;
    return function DatetimeInput_Factory(__ngFactoryType__) {
      return (ɵDatetimeInput_BaseFactory || (ɵDatetimeInput_BaseFactory = ɵɵgetInheritedFactory(_DatetimeInput)))(__ngFactoryType__ || _DatetimeInput);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _DatetimeInput,
    selectors: [["a2ui-datetime-input"]],
    inputs: {
      value: [1, "value"],
      enableDate: [1, "enableDate"],
      enableTime: [1, "enableTime"]
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 4,
    vars: 13,
    consts: [[3, "for"], ["autocomplete", "off", 3, "input", "id", "value"]],
    template: function DatetimeInput_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵdomElementStart(0, "section")(1, "label", 0);
        ɵɵtext(2);
        ɵɵdomElementEnd();
        ɵɵdomElementStart(3, "input", 1);
        ɵɵdomListener("input", function DatetimeInput_Template_input_input_3_listener($event) {
          return ctx.handleInput($event);
        });
        ɵɵdomElementEnd()();
      }
      if (rf & 2) {
        ɵɵclassMap(ctx.theme.components.DateTimeInput.container);
        ɵɵadvance();
        ɵɵclassMap(ctx.theme.components.DateTimeInput.label);
        ɵɵdomProperty("htmlFor", ctx.inputId);
        ɵɵadvance();
        ɵɵtextInterpolate(ctx.label());
        ɵɵadvance();
        ɵɵstyleMap(ctx.theme.additionalStyles == null ? null : ctx.theme.additionalStyles.DateTimeInput);
        ɵɵclassMap(ctx.theme.components.DateTimeInput.element);
        ɵɵdomProperty("id", ctx.inputId)("value", ctx.inputValue());
        ɵɵattribute("type", ctx.inputType());
      }
    },
    styles: ["[_nghost-%COMP%]{display:block;flex:var(--weight);min-height:0;overflow:auto}input[_ngcontent-%COMP%]{display:block;width:100%;box-sizing:border-box}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(DatetimeInput, [{
    type: Component,
    args: [{
      selector: "a2ui-datetime-input",
      template: `
    <section [class]="theme.components.DateTimeInput.container">
      <label [for]="inputId" [class]="theme.components.DateTimeInput.label">{{ label() }}</label>

      <input
        autocomplete="off"
        [attr.type]="inputType()"
        [id]="inputId"
        [class]="theme.components.DateTimeInput.element"
        [style]="theme.additionalStyles?.DateTimeInput"
        [value]="inputValue()"
        (input)="handleInput($event)"
      />
    </section>
  `,
      styles: [":host{display:block;flex:var(--weight);min-height:0;overflow:auto}input{display:block;width:100%;box-sizing:border-box}\n"]
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
    enableDate: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "enableDate",
        required: true
      }]
    }],
    enableTime: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "enableTime",
        required: true
      }]
    }]
  });
})();
export {
  DatetimeInput
};
//# sourceMappingURL=a2ui-angular-datetime-input-dmZAjvrF-ZJGYSO5N.js.map
