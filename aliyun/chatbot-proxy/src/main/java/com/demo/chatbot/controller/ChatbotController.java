package com.demo.chatbot.controller;

import com.demo.chatbot.impl.ChatbotServiceImpl;
import com.demo.chatbot.interfaces.request.BeginSessionRequest;
import com.demo.chatbot.interfaces.request.DialogueRequest;
import com.demo.chatbot.interfaces.request.EndSessionRequest;
import com.demo.chatbot.interfaces.request.AbortDialogueRequest;
import com.demo.chatbot.interfaces.response.GenericResponse;
import com.demo.chatbot.interfaces.response.BaseResponse;
import com.demo.chatbot.interfaces.dto.AnswerDto;
import com.demo.chatbot.interfaces.SseCallback;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;

@RestController
@RequestMapping("/api")
public class ChatbotController {

    @Autowired
    private ChatbotServiceImpl chatbotService;

    @PostMapping("/beginSession")
    public SseEmitter beginSession(@RequestBody BeginSessionRequest request) {
        SseEmitter emitter = new SseEmitter(30000L); // 30 seconds timeout
        
        chatbotService.beginSession(request, new SseCallback<GenericResponse<AnswerDto>>() {
            @Override
            public void onResponse(GenericResponse<AnswerDto> response) {
                try {
                    emitter.send(SseEmitter.event()
                            .name("message")
                            .data(response));
                    if (response.getData() != null && response.getData().isStreamEnd()) {
                        emitter.complete();
                    }
                } catch (IOException e) {
                    emitter.completeWithError(e);
                }
            }
        });
        
        return emitter;
    }

    @PostMapping("/dialogue")
    public SseEmitter dialogue(@RequestBody DialogueRequest request) {
        SseEmitter emitter = new SseEmitter(30000L); // 30 seconds timeout
        
        chatbotService.dialogue(request, new SseCallback<GenericResponse<AnswerDto>>() {
            @Override
            public void onResponse(GenericResponse<AnswerDto> response) {
                try {
                    emitter.send(SseEmitter.event()
                            .name("message")
                            .data(response));
                    if (response.getData() != null && response.getData().isStreamEnd()) {
                        emitter.complete();
                    }
                } catch (IOException e) {
                    emitter.completeWithError(e);
                }
            }
        });
        
        return emitter;
    }

    @PostMapping("/abortDialogue")
    public BaseResponse abortDialogue(@RequestBody AbortDialogueRequest request) {
        return chatbotService.abortDialogue(request);
    }

    @PostMapping("/endSession")
    public BaseResponse endSession(@RequestBody EndSessionRequest request) {
        return chatbotService.endSession(request);
    }
}