import { useEffect } from 'react';
import { AppState } from 'react-native';
import { startDiscovery, stopDiscovery } from './runtime';

// Connection recovery belongs to the app session, not the home-screen UI.
export default function PlusLifecycle() {
  useEffect(()=>{
    if(AppState.currentState!=='background')void startDiscovery().catch(()=>{});
    const subscription=AppState.addEventListener('change',state=>{
      if(state==='active')void startDiscovery().catch(()=>{});else stopDiscovery();
    });
    return ()=>{subscription.remove();stopDiscovery();};
  },[]);
  return null;
}
