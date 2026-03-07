import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

interface Citation {
    index: number
    text: string
    source: "screenshot" | "page_content" | "url"
}

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    isStreaming?: boolean
    citations?: Citation[]
}

interface ChatContextType {
    messages: Message[]
    isLoading: boolean

    sendMessage: (content: string) => Promise<void>
    clearChat: () => void

    getPageContent: () => Promise<string | null>
    getPageText: () => Promise<string | null>
    getCurrentUrl: () => Promise<string | null>
}

const ChatContext = createContext<ChatContextType | null>(null)

export const useChat = () => {
    const context = useContext(ChatContext)
    if (!context) {
        throw new Error('useChat must be used within a ChatProvider')
    }
    return context
}

function convertMessagesData(data: any): Message[] {
    if (!data) return []

    const rawMessages = Array.isArray(data) ? data : data.messages
    const messageIds: string[] = Array.isArray(data) ? [] : (data.messageIds || [])
    const citationsMap: Record<string, Citation[]> = Array.isArray(data)
        ? {}
        : (data.citations || {})

    if (!rawMessages || rawMessages.length === 0) return []

    return rawMessages.map((msg: any, index: number) => {
        const id = messageIds[index] || `msg-${index}`
        return {
            id,
            role: msg.role,
            content: typeof msg.content === 'string'
                ? msg.content
                : msg.content?.find((p: any) => p.type === 'text')?.text || '',
            timestamp: Date.now(),
            isStreaming: false,
            citations: citationsMap[id] || undefined,
        }
    })
}

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [messages, setMessages] = useState<Message[]>([])
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        const loadMessages = async () => {
            try {
                const data = await window.sidebarAPI.getMessages()
                const converted = convertMessagesData(data)
                if (converted.length > 0) setMessages(converted)
            } catch (error) {
                console.error('Failed to load messages:', error)
            }
        }
        loadMessages()
    }, [])

    const sendMessage = useCallback(async (content: string) => {
        setIsLoading(true)
        try {
            const messageId = Date.now().toString()
            await window.sidebarAPI.sendChatMessage({
                message: content,
                messageId,
            })
        } catch (error) {
            console.error('Failed to send message:', error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    const clearChat = useCallback(async () => {
        try {
            await window.sidebarAPI.clearChat()
            setMessages([])
        } catch (error) {
            console.error('Failed to clear chat:', error)
        }
    }, [])

    const getPageContent = useCallback(async () => {
        try { return await window.sidebarAPI.getPageContent() }
        catch { return null }
    }, [])

    const getPageText = useCallback(async () => {
        try { return await window.sidebarAPI.getPageText() }
        catch { return null }
    }, [])

    const getCurrentUrl = useCallback(async () => {
        try { return await window.sidebarAPI.getCurrentUrl() }
        catch { return null }
    }, [])

    useEffect(() => {
        const handleChatResponse = (data: { messageId: string; content: string; isComplete: boolean }) => {
            if (data.isComplete) setIsLoading(false)
        }

        const handleMessagesUpdated = (data: any) => {
            setMessages(convertMessagesData(data))
        }

        window.sidebarAPI.onChatResponse(handleChatResponse)
        window.sidebarAPI.onMessagesUpdated(handleMessagesUpdated)

        return () => {
            window.sidebarAPI.removeChatResponseListener()
            window.sidebarAPI.removeMessagesUpdatedListener()
        }
    }, [])

    const value: ChatContextType = {
        messages,
        isLoading,
        sendMessage,
        clearChat,
        getPageContent,
        getPageText,
        getCurrentUrl,
    }

    return (
        <ChatContext.Provider value={value}>
            {children}
        </ChatContext.Provider>
    )
}
