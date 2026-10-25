/**
 * Dense form primitives for "ledger" style pages: titled sections, a
 * two-up field grid on desktop that stacks on phones, dense field defaults
 * and a resizable master/detail split.
 */
export { FormSection, type FormSectionProps } from './FormSection';
export { FormGrid, FormRow, type FormGridProps, type FormRowProps } from './FormRow';
export { DENSE_TEXT_FIELD_PROPS, useDenseFieldSize } from './denseFields';
export { MasterDetailLayout, type MasterDetailLayoutProps } from './MasterDetailLayout';
