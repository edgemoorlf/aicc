package com.demo.chatbot.interfaces.dto;

import com.demo.chatbot.interfaces.constant.ControlType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import lombok.Builder;
import lombok.Data;


@Builder
@Data
public class DtmfControlParams implements ControlParams {
    /**
     * 收号结束标志位，默认值是#。
     * <p>
     * 限制：只支持#
     * </p>
     */
    @NotEmpty
    @Builder.Default
    private String terminator = "#";

    /**
     * 最大按键输入个数，默认值是1。
     * <p>
     * 限制：取值范围为1~100。
     * </p>
     */
    @Max(100)
    @Min(1)
    @Builder.Default
    private int maxDigits = 1;

    /**
     * 收号超时时间,单个按键超时时间，单位是秒。
     * <p>
     * 限制：取值范围为1~10，推荐5s。
     * </p>
     */
    @Max(10)
    @Min(1)
    @Builder.Default
    private int timeout = 5;

    @Override
    public ControlType getType() {
        return ControlType.GatherDtmf;
    }
}
