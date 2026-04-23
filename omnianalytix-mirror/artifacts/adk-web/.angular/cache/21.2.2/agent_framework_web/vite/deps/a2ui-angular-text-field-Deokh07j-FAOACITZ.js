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
  ɵɵdomListener,
  ɵɵdomProperty,
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

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-text-field-Deokh07j.mjs
function TextField_Conditional_2_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵdomElementStart(0, "label", 2);
    ɵɵtext(1);
    ɵɵdomElementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = ɵɵnextContext();
    const resolvedLabel_r2 = ɵɵreadContextLet(0);
    ɵɵclassMap(ctx_r0.theme.components.TextField.label);
    ɵɵdomProperty("htmlFor", ctx_r0.inputId);
    ɵɵadvance();
    ɵɵtextInterpolate(resolvedLabel_r2);
  }
}
var TextField = class _TextField extends DynamicComponent {
  text = input.required(...ngDevMode ? [{
    debugName: "text"
  }] : []);
  label = input.required(...ngDevMode ? [{
    debugName: "label"
  }] : []);
  inputType = input.required(...ngDevMode ? [{
    debugName: "inputType"
  }] : []);
  inputValue = computed(() => super.resolvePrimitive(this.text()) || "", ...ngDevMode ? [{
    debugName: "inputValue"
  }] : []);
  resolvedLabel = computed(() => super.resolvePrimitive(this.label()), ...ngDevMode ? [{
    debugName: "resolvedLabel"
  }] : []);
  inputId = super.getUniqueId("a2ui-input");
  handleInput(event) {
    const path = this.text()?.path;
    if (!(event.target instanceof HTMLInputElement) || !path) {
      return;
    }
    this.processor.setData(this.component(), path, event.target.value, this.surfaceId());
  }
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵTextField_BaseFactory;
    return function TextField_Factory(__ngFactoryType__) {
      return (ɵTextField_BaseFactory || (ɵTextField_BaseFactory = ɵɵgetInheritedFactory(_TextField)))(__ngFactoryType__ || _TextField);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _TextField,
    selectors: [["a2ui-text-field"]],
    inputs: {
      text: [1, "text"],
      label: [1, "label"],
      inputType: [1, "inputType"]
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 4,
    vars: 11,
    consts: [[3, "for", "class"], ["autocomplete", "off", "placeholder", "Please enter a value", 3, "input", "id", "value", "type"], [3, "for"]],
    template: function TextField_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵdeclareLet(0);
        ɵɵdomElementStart(1, "section");
        ɵɵconditionalCreate(2, TextField_Conditional_2_Template, 2, 4, "label", 0);
        ɵɵdomElementStart(3, "input", 1);
        ɵɵdomListener("input", function TextField_Template_input_input_3_listener($event) {
          return ctx.handleInput($event);
        });
        ɵɵdomElementEnd()();
      }
      if (rf & 2) {
        const resolvedLabel_r3 = ɵɵstoreLet(ctx.resolvedLabel());
        ɵɵadvance();
        ɵɵclassMap(ctx.theme.components.TextField.container);
        ɵɵadvance();
        ɵɵconditional(resolvedLabel_r3 ? 2 : -1);
        ɵɵadvance();
        ɵɵstyleMap(ctx.theme.additionalStyles == null ? null : ctx.theme.additionalStyles.TextField);
        ɵɵclassMap(ctx.theme.components.TextField.element);
        ɵɵdomProperty("id", ctx.inputId)("value", ctx.inputValue())("type", ctx.inputType() === "number" ? "number" : "text");
      }
    },
    styles: ["[_nghost-%COMP%]{display:flex;flex:var(--weight)}section[_ngcontent-%COMP%], input[_ngcontent-%COMP%], label[_ngcontent-%COMP%]{box-sizing:border-box}input[_ngcontent-%COMP%]{display:block;width:100%}label[_ngcontent-%COMP%]{display:block;margin-bottom:4px}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(TextField, [{
    type: Component,
    args: [{
      selector: "a2ui-text-field",
      template: `
    @let resolvedLabel = this.resolvedLabel();

    <section [class]="theme.components.TextField.container">
      @if (resolvedLabel) {
        <label [for]="inputId" [class]="theme.components.TextField.label">{{
          resolvedLabel
        }}</label>
      }

      <input
        autocomplete="off"
        [class]="theme.components.TextField.element"
        [style]="theme.additionalStyles?.TextField"
        (input)="handleInput($event)"
        [id]="inputId"
        [value]="inputValue()"
        placeholder="Please enter a value"
        [type]="inputType() === 'number' ? 'number' : 'text'"
      />
    </section>
  `,
      styles: [":host{display:flex;flex:var(--weight)}section,input,label{box-sizing:border-box}input{display:block;width:100%}label{display:block;margin-bottom:4px}\n"]
    }]
  }], null, {
    text: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "text",
        required: true
      }]
    }],
    label: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "label",
        required: true
      }]
    }],
    inputType: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "inputType",
        required: true
      }]
    }]
  });
})();
export {
  TextField
};
//# sourceMappingURL=a2ui-angular-text-field-Deokh07j-FAOACITZ.js.map
