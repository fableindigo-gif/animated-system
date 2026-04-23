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
  ViewEncapsulation,
  setClassMetadata,
  ɵɵInheritDefinitionFeature,
  ɵɵadvance,
  ɵɵclassMap,
  ɵɵdefineComponent,
  ɵɵelementContainer,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetInheritedFactory,
  ɵɵnextContext,
  ɵɵproperty,
  ɵɵpureFunction1,
  ɵɵrepeater,
  ɵɵrepeaterCreate,
  ɵɵrepeaterTrackByIdentity,
  ɵɵstyleMap
} from "./chunk-A2DGQQFJ.js";
import "./chunk-ZIK34A2Q.js";
import "./chunk-SN3C37HS.js";
import "./chunk-IYAMKWW5.js";
import "./chunk-QZRS5QDR.js";
import "./chunk-YSYTNXRR.js";
import "./chunk-IZIF4DQH.js";

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-card-Ix6OIdUv.mjs
var _c0 = (a0) => [a0];
function Card_For_2_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵelementContainer(0, 0);
  }
  if (rf & 2) {
    const child_r1 = ctx.$implicit;
    const ctx_r1 = ɵɵnextContext();
    ɵɵproperty("surfaceId", ctx_r1.surfaceId())("component", child_r1);
  }
}
var Card = class _Card extends DynamicComponent {
  static ɵfac = /* @__PURE__ */ (() => {
    let ɵCard_BaseFactory;
    return function Card_Factory(__ngFactoryType__) {
      return (ɵCard_BaseFactory || (ɵCard_BaseFactory = ɵɵgetInheritedFactory(_Card)))(__ngFactoryType__ || _Card);
    };
  })();
  static ɵcmp = ɵɵdefineComponent({
    type: _Card,
    selectors: [["a2ui-card"]],
    features: [ɵɵInheritDefinitionFeature],
    decls: 3,
    vars: 6,
    consts: [["a2ui-renderer", "", 3, "surfaceId", "component"]],
    template: function Card_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵelementStart(0, "section");
        ɵɵrepeaterCreate(1, Card_For_2_Template, 1, 2, "ng-container", 0, ɵɵrepeaterTrackByIdentity);
        ɵɵelementEnd();
      }
      if (rf & 2) {
        const properties_r3 = ctx.component().properties;
        const children_r4 = properties_r3.children || ɵɵpureFunction1(4, _c0, properties_r3.child);
        ɵɵstyleMap(ctx.theme.additionalStyles == null ? null : ctx.theme.additionalStyles.Card);
        ɵɵclassMap(ctx.theme.components.Card);
        ɵɵadvance();
        ɵɵrepeater(children_r4);
      }
    },
    dependencies: [Renderer],
    styles: ["a2ui-card{display:block;flex:var(--weight);min-height:0;overflow:auto}a2ui-card>section{height:100%;width:100%;min-height:0;overflow:auto}a2ui-card>section>*{height:100%;width:100%}\n"],
    encapsulation: 2
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Card, [{
    type: Component,
    args: [{
      selector: "a2ui-card",
      imports: [Renderer],
      encapsulation: ViewEncapsulation.None,
      template: `
    @let properties = component().properties;
    @let children = properties.children || [properties.child];

    <section [class]="theme.components.Card" [style]="theme.additionalStyles?.Card">
      @for (child of children; track child) {
        <ng-container a2ui-renderer [surfaceId]="surfaceId()!" [component]="child" />
      }
    </section>
  `,
      styles: ["a2ui-card{display:block;flex:var(--weight);min-height:0;overflow:auto}a2ui-card>section{height:100%;width:100%;min-height:0;overflow:auto}a2ui-card>section>*{height:100%;width:100%}\n"]
    }]
  }], null, null);
})();
export {
  Card
};
//# sourceMappingURL=a2ui-angular-card-Ix6OIdUv-MB7MP32P.js.map
