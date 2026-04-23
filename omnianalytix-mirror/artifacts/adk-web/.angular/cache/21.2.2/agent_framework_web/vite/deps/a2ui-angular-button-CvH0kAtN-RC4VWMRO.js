import {
  DynamicComponent,
  Renderer
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
  ɵɵelementContainer,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetInheritedFactory,
  ɵɵlistener,
  ɵɵproperty,
  ɵɵstyleMap
} from "./chunk-A2DGQQFJ.js";
import "./chunk-ZIK34A2Q.js";
import "./chunk-SN3C37HS.js";
import "./chunk-IYAMKWW5.js";
import "./chunk-QZRS5QDR.js";
import "./chunk-YSYTNXRR.js";
import "./chunk-IZIF4DQH.js";

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-button-CvH0kAtN.mjs
var Button = class _Button extends DynamicComponent {
  action = input.required(...ngDevMode ? [{
    debugName: "action"
  }] : []);
  handleClick() {
    const action = this.action();
    if (action) {
      super.sendAction(action);
    }
  }
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵButton_BaseFactory;
    return function Button_Factory(__ngFactoryType__) {
      return (ɵButton_BaseFactory || (ɵButton_BaseFactory = ɵɵgetInheritedFactory(_Button)))(__ngFactoryType__ || _Button);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _Button,
    selectors: [["a2ui-button"]],
    inputs: {
      action: [1, "action"]
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 2,
    vars: 6,
    consts: [[3, "click"], ["a2ui-renderer", "", 3, "surfaceId", "component"]],
    template: function Button_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵelementStart(0, "button", 0);
        ɵɵlistener("click", function Button_Template_button_click_0_listener() {
          return ctx.handleClick();
        });
        ɵɵelementContainer(1, 1);
        ɵɵelementEnd();
      }
      if (rf & 2) {
        ɵɵstyleMap(ctx.theme.additionalStyles == null ? null : ctx.theme.additionalStyles.Button);
        ɵɵclassMap(ctx.theme.components.Button);
        ɵɵadvance();
        ɵɵproperty("surfaceId", ctx.surfaceId())("component", ctx.component().properties.child);
      }
    },
    dependencies: [Renderer],
    styles: ["[_nghost-%COMP%]{display:block;flex:var(--weight);min-height:0}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Button, [{
    type: Component,
    args: [{
      selector: "a2ui-button",
      imports: [Renderer],
      template: `
    <button
      [class]="theme.components.Button"
      [style]="theme.additionalStyles?.Button"
      (click)="handleClick()"
    >
      <ng-container
        a2ui-renderer
        [surfaceId]="surfaceId()!"
        [component]="component().properties.child"
      />
    </button>
  `,
      styles: [":host{display:block;flex:var(--weight);min-height:0}\n"]
    }]
  }], null, {
    action: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "action",
        required: true
      }]
    }]
  });
})();
export {
  Button
};
//# sourceMappingURL=a2ui-angular-button-CvH0kAtN-RC4VWMRO.js.map
