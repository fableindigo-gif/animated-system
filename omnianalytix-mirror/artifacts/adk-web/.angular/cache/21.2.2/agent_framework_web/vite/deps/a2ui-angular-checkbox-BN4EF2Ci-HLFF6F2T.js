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

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-checkbox-BN4EF2Ci.mjs
var Checkbox = class _Checkbox extends DynamicComponent {
  value = input.required(...ngDevMode ? [{
    debugName: "value"
  }] : []);
  label = input.required(...ngDevMode ? [{
    debugName: "label"
  }] : []);
  inputChecked = computed(() => super.resolvePrimitive(this.value()) ?? false, ...ngDevMode ? [{
    debugName: "inputChecked"
  }] : []);
  resolvedLabel = computed(() => super.resolvePrimitive(this.label()), ...ngDevMode ? [{
    debugName: "resolvedLabel"
  }] : []);
  inputId = super.getUniqueId("a2ui-checkbox");
  handleChange(event) {
    const path = this.value()?.path;
    if (!(event.target instanceof HTMLInputElement) || !path) {
      return;
    }
    this.processor.setData(this.component(), path, event.target.checked, this.surfaceId());
  }
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵCheckbox_BaseFactory;
    return function Checkbox_Factory(__ngFactoryType__) {
      return (ɵCheckbox_BaseFactory || (ɵCheckbox_BaseFactory = ɵɵgetInheritedFactory(_Checkbox)))(__ngFactoryType__ || _Checkbox);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _Checkbox,
    selectors: [["a2ui-checkbox"]],
    inputs: {
      value: [1, "value"],
      label: [1, "label"]
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 4,
    vars: 12,
    consts: [["autocomplete", "off", "type", "checkbox", 3, "change", "id", "checked"], [3, "htmlFor"]],
    template: function Checkbox_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵdomElementStart(0, "section")(1, "input", 0);
        ɵɵdomListener("change", function Checkbox_Template_input_change_1_listener($event) {
          return ctx.handleChange($event);
        });
        ɵɵdomElementEnd();
        ɵɵdomElementStart(2, "label", 1);
        ɵɵtext(3);
        ɵɵdomElementEnd()();
      }
      if (rf & 2) {
        ɵɵstyleMap(ctx.theme.additionalStyles == null ? null : ctx.theme.additionalStyles.CheckBox);
        ɵɵclassMap(ctx.theme.components.CheckBox.container);
        ɵɵadvance();
        ɵɵclassMap(ctx.theme.components.CheckBox.element);
        ɵɵdomProperty("id", ctx.inputId)("checked", ctx.inputChecked());
        ɵɵadvance();
        ɵɵclassMap(ctx.theme.components.CheckBox.label);
        ɵɵdomProperty("htmlFor", ctx.inputId);
        ɵɵadvance();
        ɵɵtextInterpolate(ctx.resolvedLabel());
      }
    },
    styles: ["[_nghost-%COMP%]{display:block;flex:var(--weight);min-height:0;overflow:auto}input[_ngcontent-%COMP%]{display:block;width:100%}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Checkbox, [{
    type: Component,
    args: [{
      selector: "a2ui-checkbox",
      template: `
    <section
      [class]="theme.components.CheckBox.container"
      [style]="theme.additionalStyles?.CheckBox"
    >
      <input
        autocomplete="off"
        type="checkbox"
        [id]="inputId"
        [checked]="inputChecked()"
        [class]="theme.components.CheckBox.element"
        (change)="handleChange($event)"
      />

      <label [htmlFor]="inputId" [class]="theme.components.CheckBox.label">{{
        resolvedLabel()
      }}</label>
    </section>
  `,
      styles: [":host{display:block;flex:var(--weight);min-height:0;overflow:auto}input{display:block;width:100%}\n"]
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
        required: true
      }]
    }]
  });
})();
export {
  Checkbox
};
//# sourceMappingURL=a2ui-angular-checkbox-BN4EF2Ci-HLFF6F2T.js.map
