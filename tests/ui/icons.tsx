import React from 'react';
import {Clock,CheckCircle,Circle,CheckSquare,UploadCloud,RefreshCw,MoreHorizontal,X,Copy,Clipboard,File,Settings} from 'lucide-react';
const icons={clock:Clock,'check-circle':CheckCircle,circle:Circle,'check-square':CheckSquare,'upload-cloud':UploadCloud,'refresh-cw':RefreshCw,'more-horizontal':MoreHorizontal,x:X,copy:Copy,clipboard:Clipboard,file:File,settings:Settings};
export function Feather({name,size=18,color}:{name:string;size?:number;color?:string}) {const Icon=icons[name]||Circle;return <Icon size={size} color={color} strokeWidth={1.8}/>;}
