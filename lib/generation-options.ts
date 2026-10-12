export const CAPTION_STYLES = ['dry', 'chaotic', 'wholesome', 'wordplay', 'roast'] as const
export const CAPTION_TOPICS = ['campus', 'study', 'roommates', 'nyc', 'food', 'internet', 'other'] as const
export const CAPTION_PERSPECTIVES = ['observer', 'student', 'roommate', 'tourist', 'object'] as const
export type CaptionStyle = typeof CAPTION_STYLES[number]
export type CaptionTopic = typeof CAPTION_TOPICS[number]
export type CaptionPerspective = typeof CAPTION_PERSPECTIVES[number]
export const topicLabels: Record<CaptionTopic, string> = {campus:'Campus life', study:'Study spiral', roommates:'Roommates', nyc:'NYC weekends', food:'Food & coffee', internet:'Internet brain', other:'Anything goes'}
export const perspectiveLabels: Record<CaptionPerspective, string> = {observer:'An observer', student:'A student', roommate:'The roommate', tourist:'New to NYC', object:'The object in the photo'}
