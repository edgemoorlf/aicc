package com.demo.chatbot.interfaces.dto;

import com.demo.chatbot.interfaces.constant.ControlType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.Builder;
import lombok.Data;


@Builder
@Data
public class VoiceControlParams implements ControlParams {
    /**
     * 机器人是否支持被打断，默认值false。
     */
    @Builder.Default
    private boolean interruptible = false;
    /**
     * 用户静默超时时间，默认5s。
     * <p>
     * 限制：取值范围为1~10，推荐5s。
     * </p>
     */
    @Max(10)
    @Min(1)
    @Builder.Default
    private int silenceDetectionTimeout = 5;

    @Override
    public ControlType getType() {
        return ControlType.Voice;
    }
}
