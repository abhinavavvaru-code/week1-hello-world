import type { Caption } from './captions'
import {topicLabels,type CaptionTopic} from './generation-options'
export type GalleryFilter = 'all' | 'unrated' | 'up' | 'down' | 'new' | 'mine'
export function filterCaptions(captions: Caption[], options: {filter: GalleryFilter;sort:string;query:string;topic:string;style:string;author:string;userId:string;newCaptionIds:string[];history:boolean}) {
  const query=options.query.trim().toLocaleLowerCase('en-US')
  return captions.filter((caption)=>
    (!options.history || caption.myVote!==0)
    && (options.filter==='all' || (options.filter==='unrated' && caption.myVote===0) || (options.filter==='up' && caption.myVote===1) || (options.filter==='down' && caption.myVote===-1) || (options.filter==='mine' && caption.authorId===options.userId) || (options.filter==='new' && options.newCaptionIds.includes(caption.id)))
    && (!options.topic || caption.topic===options.topic)
    && (!options.style || caption.style===options.style)
    && (!options.author || caption.authorId===options.author)
    && (!query || `${caption.content} ${caption.authorName} ${caption.topic} ${topicLabels[caption.topic as CaptionTopic] || ''} ${caption.style}`.toLocaleLowerCase('en-US').includes(query))
  ).sort((a,b)=> {
    const difference=options.sort==='week' ? b.weekUpvotes-a.weekUpvotes : options.sort==='month' ? b.monthUpvotes-a.monthUpvotes : options.sort==='top' ? b.laughs-a.laughs : 0
    return difference || (options.sort!=='latest' ? (b.laughs-b.groans)-(a.laughs-a.groans) : 0)
      || (options.history ? (b.votedAt??'').localeCompare(a.votedAt??'') : b.createdAt.localeCompare(a.createdAt)) || b.id.localeCompare(a.id)
  })
}
