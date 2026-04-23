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
  ɵɵnextContext,
  ɵɵrepeater,
  ɵɵrepeaterCreate,
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

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-multiple-choice-Bry7X74i.mjs
var _forTrack0 = ($index, $item) => $item.value;
function MultipleChoice_For_5_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵdomElementStart(0, "option", 2);
    ɵɵtext(1);
    ɵɵdomElementEnd();
  }
  if (rf & 2) {
    const option_r1 = ctx.$implicit;
    const ctx_r1 = ɵɵnextContext();
    ɵɵdomProperty("value", option_r1.value);
    ɵɵadvance();
    ɵɵtextInterpolate(ctx_r1.resolvePrimitive(option_r1.label));
  }
}
var MultipleChoice = class _MultipleChoice extends DynamicComponent {
  options = input.required(...ngDevMode ? [{
    debugName: "options"
  }] : []);
  value = input.required(...ngDevMode ? [{
    debugName: "value"
  }] : []);
  description = input.required(...ngDevMode ? [{
    debugName: "description"
  }] : []);
  selectId = super.getUniqueId("a2ui-multiple-choice");
  selectValue = computed(() => super.resolvePrimitive(this.value()), ...ngDevMode ? [{
    debugName: "selectValue"
  }] : []);
  handleChange(event) {
    const path = this.value()?.path;
    if (!(event.target instanceof HTMLSelectElement) || !event.target.value || !path) {
      return;
    }
    this.processor.setData(this.component(), this.processor.resolvePath(path, this.component().dataContextPath), event.target.value);
  }
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵMultipleChoice_BaseFactory;
    return function MultipleChoice_Factory(__ngFactoryType__) {
      return (ɵMultipleChoice_BaseFactory || (ɵMultipleChoice_BaseFactory = ɵɵgetInheritedFactory(_MultipleChoice)))(__ngFactoryType__ || _MultipleChoice);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _MultipleChoice,
    selectors: [["a2ui-multiple-choice"]],
    inputs: {
      options: [1, "options"],
      value: [1, "value"],
      description: [1, "description"]
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 6,
    vars: 12,
    consts: [[3, "for"], [3, "change", "id", "value"], [3, "value"]],
    template: function MultipleChoice_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵdomElementStart(0, "section")(1, "label", 0);
        ɵɵtext(2);
        ɵɵdomElementEnd();
        ɵɵdomElementStart(3, "select", 1);
        ɵɵdomListener("change", function MultipleChoice_Template_select_change_3_listener($event) {
          return ctx.handleChange($event);
        });
        ɵɵrepeaterCreate(4, MultipleChoice_For_5_Template, 2, 2, "option", 2, _forTrack0);
        ɵɵdomElementEnd()();
      }
      if (rf & 2) {
        ɵɵclassMap(ctx.theme.components.MultipleChoice.container);
        ɵɵadvance();
        ɵɵclassMap(ctx.theme.components.MultipleChoice.label);
        ɵɵdomProperty("htmlFor", ctx.selectId);
        ɵɵadvance();
        ɵɵtextInterpolate(ctx.description());
        ɵɵadvance();
        ɵɵstyleMap(ctx.theme.additionalStyles == null ? null : ctx.theme.additionalStyles.MultipleChoice);
        ɵɵclassMap(ctx.theme.components.MultipleChoice.element);
        ɵɵdomProperty("id", ctx.selectId)("value", ctx.selectValue());
        ɵɵadvance();
        ɵɵrepeater(ctx.options());
      }
    },
    styles: ["[_nghost-%COMP%]{display:block;flex:var(--weight);min-height:0;overflow:auto}select[_ngcontent-%COMP%]{width:100%;box-sizing:border-box}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(MultipleChoice, [{
    type: Component,
    args: [{
      selector: "a2ui-multiple-choice",
      template: `
    <section [class]="theme.components.MultipleChoice.container">
      <label [class]="theme.components.MultipleChoice.label" [for]="selectId">{{
        description()
      }}</label>

      <select
        (change)="handleChange($event)"
        [id]="selectId"
        [value]="selectValue()"
        [class]="theme.components.MultipleChoice.element"
        [style]="theme.additionalStyles?.MultipleChoice"
      >
        @for (option of options(); track option.value) {
          <option [value]="option.value">{{ resolvePrimitive(option.label) }}</option>
        }
      </select>
    </section>
  `,
      styles: [":host{display:block;flex:var(--weight);min-height:0;overflow:auto}select{width:100%;box-sizing:border-box}\n"]
    }]
  }], null, {
    options: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "options",
        required: true
      }]
    }],
    value: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "value",
        required: true
      }]
    }],
    description: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "description",
        required: true
      }]
    }]
  });
})();
export {
  MultipleChoice
};
//# sourceMappingURL=a2ui-angular-multiple-choice-Bry7X74i-YY6I6NPB.js.map
