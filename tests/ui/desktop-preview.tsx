import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import AppHeader from '../../apps/desktop/src/features/app/components/AppHeader';
import '../../apps/desktop/src/index.css';
import '../../apps/desktop/src/styles/components/index.css';
import '../../apps/desktop/src/styles/themes/load';
function Preview(){
  const [search,setSearch]=useState('');const input=useRef<HTMLInputElement>(null);
  const noop=()=>{};
  return <div style={{height:'100vh',background:'var(--bg-primary)'}}><AppHeader
    t={key=>({app_name:'TieZ',search_placeholder:'搜索剪贴板…',type_text:'文本',type_image:'图片',type_file:'文件',type_url:'URL',type_code:'代码',type_video:'视频',type_rich_text:'富文本'}[key]||key)}
    showSettings={false} setShowSettings={noop} showTagManager={false} setShowTagManager={noop} tagManagerEnabled={true}
    showEmojiPanel={false} setShowEmojiPanel={noop} emojiPanelEnabled={false} chatMode={false} fileServerEnabled={false}
    isWindowPinned={false} setIsWindowPinned={noop} clearHistory={noop} showSearchBox={true} search={search} setSearch={setSearch}
    setIsComposing={noop} searchInputRef={input} showTagFilter={false} setShowTagFilter={noop} allTags={[]} searchIsFocused={false}
    setSearchIsFocused={noop} setEditingTagsId={noop} theme="dark" colorMode="dark" settingsTitle="设置" typeFilter={null}
    setTypeFilter={noop} onBack={noop} onToggleChat={noop}/></div>;
}
document.documentElement.dataset.theme='dark';
createRoot(document.getElementById('root')!).render(<Preview/>);
