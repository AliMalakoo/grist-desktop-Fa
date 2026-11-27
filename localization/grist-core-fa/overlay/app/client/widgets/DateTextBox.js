var _ = require("underscore");
var ko = require("knockout");
var dom = require("../lib/dom");
var dispose = require("../lib/dispose");
var kd = require("../lib/koDom");
var kf = require("../lib/koForm");
var AbstractWidget = require("./AbstractWidget");

const {FormFieldRulesConfig} = require("app/client/components/Forms/FormConfig");
const {fromKoSave} = require("app/client/lib/fromKoSave");
const {alignmentSelect, cssButtonSelect} = require("app/client/ui2018/buttonSelect");
const {cssLabel, cssRow} = require("app/client/ui/RightPanelStyles");
const {cssTextInput} = require("app/client/ui2018/editableLabel");
const {dom: gdom, styled, fromKo} = require("grainjs");
const {select} = require("app/client/ui2018/menus");
const {dateFormatOptions} = require("app/common/parseDate");
const {shouldUseJalali} = require("app/common/jalali");
const {makeT} = require("app/client/lib/localization");

const t = makeT("DateTextBox");

/**
 * DateTextBox - The most basic widget for displaying simple date information.
 */
function DateTextBox(field) {
  AbstractWidget.call(this, field);

  this.alignment = this.options.prop("alignment");

  // These properties are only used in configuration.
  this.dateFormat = this.field.config.options.prop("dateFormat");
  this.isCustomDateFormat = this.field.config.options.prop("isCustomDateFormat");
  this.mixedDateFormat = ko.pureComputed(() => this.dateFormat() === null || this.isCustomDateFormat() === null);

  // Helper to set 'dateFormat' and 'isCustomDateFormat' from the set of default date format strings.
  this.standardDateFormat = this.autoDispose(ko.computed({
    owner: this,
    read: function() { return this.mixedDateFormat() ? null : this.isCustomDateFormat() ? "Custom" : this.dateFormat(); },
    write: function(val) {
      if (val === "Custom") { this.isCustomDateFormat.setAndSave(true); } else {
        this.field.config.options.update({isCustomDateFormat: false, dateFormat: val});
        this.field.config.options.save();
      }
    }
  }));

  // Whether dates are shown (and typed) in the Jalali calendar rather than the Gregorian one.
  // Absent means "follow the document's language", which is what makes a Persian document use a
  // Persian calendar without anyone touching this; true/false pin it for this column.
  this.jalali = this.field.config.options.prop("jalali");
  this.jalaliEffective = this.autoDispose(ko.pureComputed(() => shouldUseJalali(this.jalali())));
  this._setUpJalaliToggle();

  // An observable that always returns `UTC`, eases DateTimeEditor inheritance.
  this.timezone = ko.observable("UTC");
}
dispose.makeDisposable(DateTextBox);
_.extend(DateTextBox.prototype, AbstractWidget.prototype);

DateTextBox.prototype.buildDateConfigDom = function() {
  const disabled = this.field.config.options.disabled("dateFormat");
  return dom("div",
    cssLabel("Date Format"),
    cssRow(dom(select(
      fromKo(this.standardDateFormat),
      [...dateFormatOptions, "Custom"],
      { disabled, defaultLabel: "Mixed format" },
    ), dom.testId("Widget_dateFormat"))),
    kd.maybe(() => !this.mixedDateFormat() && this.isCustomDateFormat(), () => {
      return cssRow(dom(
        textbox(this.dateFormat, { disabled }),
        dom.testId("Widget_dateCustomFormat")));
    }),
    this.buildJalaliConfigDom()
  );
};

/**
 * The calendar selector: a plain checkbox, because it is a yes/no choice rather than a format, and
 * because leaving it unticked means "use the document's language", which is the behaviour a Persian
 * document gets out of the box.
 */
DateTextBox.prototype.buildJalaliConfigDom = function() {
  const disabled = this.field.config.options.disabled("jalali");
  return dom("div",
    cssLabel(t("Calendar")),
    cssRow(dom(
      kf.checkbox(this.jalaliToggle, { disabled },
        dom("span.jjp-toggle-label", kd.computed(() => this.jalaliEffective() ?
          t("Jalali (Persian) calendar") : t("Gregorian calendar"))),
      ),
      dom.testId("Widget_dateJalali"),
    )),
    cssRow(dom("span.jjp-toggle-hint", kd.computed(() =>
      (this.jalali() === null || this.jalali() === undefined) ?
      t("Follows the document language. Dates are always stored as real dates; only how they are " +
        "shown and typed changes.") :
      t("Set for this column only; it overrides the document language.")))
    )
  );
};

/**
 * Read/write pair behind the checkbox. It reads the *effective* state, so what is ticked matches
 * what the grid shows. Writing is always explicit: unticking a column in a Persian document has to
 * store `jalali: false` rather than clearing the option, which would make the language switch the
 * calendar straight back on.
 */
DateTextBox.prototype._setUpJalaliToggle = function() {
  if (this.jalaliToggle) { return; }
  this.jalaliToggle = ko.computed({
    owner: this,
    read: () => this.jalaliEffective(),
    write: (val) => this.field.config.options.update({jalali: Boolean(val)}),
  });
  this.autoDispose(this.jalaliToggle);
};

DateTextBox.prototype.buildConfigDom = function() {
  return dom("div",
    this.buildDateConfigDom(),
    cssRow(
      alignmentSelect(
        fromKoSave(this.field.config.options.prop("alignment")),
        cssButtonSelect.cls("-disabled", this.field.config.options.disabled("alignment")),
      ),
    )
  );
};

DateTextBox.prototype.buildTransformConfigDom = function() {
  return this.buildDateConfigDom();
};

DateTextBox.prototype.buildFormConfigDom = function() {
  return [
    gdom.create(FormFieldRulesConfig, this.field),
  ];
};

DateTextBox.prototype.buildDom = function(row) {
  let value = row[this.field.colId()];
  return dom("div.field_clip",
    kd.style("text-align", this.alignment),
    kd.text(() => row._isAddRow() || this.isDisposed() ? "" : this.valueFormatter().format(value()))
  );
};

// clean up old koform styles
const cssClean = styled("div", `
  flex: 1;
  margin: 0px;
`);

// override focus - to look like modern ui
const cssFocus = styled("div", `
  &:focus {
    outline: none;
    box-shadow: 0 0 3px 2px var(--grist-color-cursor);
    border: 1px solid transparent;
  }
`);

// helper method to create old style textbox that looks like a new one
function textbox(value, options) {
  const textDom = kf.text(value, options ?? {});
  const tzInput = textDom.querySelector("input");
  dom(tzInput,
    kd.cssClass(cssTextInput.className),
    kd.cssClass(cssFocus.className)
  );
  dom(textDom,
    kd.cssClass(cssClean.className)
  );
  return textDom;
}

module.exports = DateTextBox;
