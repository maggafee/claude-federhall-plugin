cmake_minimum_required(VERSION 3.22)

project(DubascoSpringReverb VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "10.13" CACHE STRING "Minimum macOS version")
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

option(DUBASCO_BUILD_CLAP "Build the CLAP format too" ON)

# ---------------------------------------------------------------- dependencies
# Use a local JUCE checkout with -DJUCE_DIR=/path/to/JUCE, otherwise fetch it.
include(FetchContent)
if(DEFINED JUCE_DIR)
    add_subdirectory(${JUCE_DIR} ${CMAKE_BINARY_DIR}/JUCE EXCLUDE_FROM_ALL)
else()
    FetchContent_Declare(JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG 8.0.9
        GIT_SHALLOW ON)
    FetchContent_MakeAvailable(JUCE)
endif()

# ---------------------------------------------------------------- plugin
set(DUBASCO_FORMATS VST3 Standalone)
if(APPLE)
    list(APPEND DUBASCO_FORMATS AU)
endif()

juce_add_plugin(DubascoSpringReverb
    COMPANY_NAME "Dubasco"
    COMPANY_WEBSITE "https://dubasco.local"
    BUNDLE_ID "com.dubasco.springreverb"
    PLUGIN_MANUFACTURER_CODE Dbsc
    PLUGIN_CODE Dsrv
    PRODUCT_NAME "Dubasco Spring Reverb"
    DESCRIPTION "Jamaican dub spring & plate reverb"
    FORMATS ${DUBASCO_FORMATS}
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    VST3_CATEGORIES Fx Reverb
    AU_MAIN_TYPE kAudioUnitType_Effect
    COPY_PLUGIN_AFTER_BUILD FALSE)

juce_generate_juce_header(DubascoSpringReverb)

target_sources(DubascoSpringReverb PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/gui/Widgets.cpp
    Source/gui/SpringTankView.cpp)

target_include_directories(DubascoSpringReverb PRIVATE Source)

juce_add_binary_data(DubascoAssets SOURCES
    Assets/background.jpg
    Assets/knobcap_l.png
    Assets/knobcap_s.png
    Assets/lamp_on.png
    Assets/lamp_off.png
    Assets/lever_base.png
    Assets/lever_arm.png
    Assets/tank_base.png
    Assets/tank_hot.png
    Assets/spring1.png
    Assets/spring2.png
    Assets/spring3.png
    Assets/springhot1.png
    Assets/springhot2.png
    Assets/springhot3.png)

target_compile_definitions(DubascoSpringReverb PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(DubascoSpringReverb
    PRIVATE
        DubascoAssets
        juce::juce_audio_utils
        juce::juce_dsp
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)

# ---------------------------------------------------------------- CLAP
if(DUBASCO_BUILD_CLAP)
    if(DEFINED CLAP_JUCE_EXTENSIONS_DIR)
        add_subdirectory(${CLAP_JUCE_EXTENSIONS_DIR} ${CMAKE_BINARY_DIR}/clap-juce-extensions EXCLUDE_FROM_ALL)
    else()
        FetchContent_Declare(clap-juce-extensions
            GIT_REPOSITORY https://github.com/free-audio/clap-juce-extensions.git
            GIT_TAG main
            GIT_SHALLOW ON)
        FetchContent_MakeAvailable(clap-juce-extensions)
    endif()
    clap_juce_extensions_plugin(TARGET DubascoSpringReverb
        CLAP_ID "com.dubasco.springreverb"
        CLAP_FEATURES audio-effect reverb stereo)
endif()

# ---------------------------------------------------------------- offline DSP test
option(DUBASCO_BUILD_TESTS "Build the offline render test" OFF)
if(DUBASCO_BUILD_TESTS)
    juce_add_console_app(DubascoRenderTest PRODUCT_NAME "DubascoRenderTest")
    target_sources(DubascoRenderTest PRIVATE tests/RenderTest.cpp Source/PluginProcessor.cpp
        Source/PluginEditor.cpp Source/gui/Widgets.cpp Source/gui/SpringTankView.cpp)
    target_include_directories(DubascoRenderTest PRIVATE Source)
    target_compile_definitions(DubascoRenderTest PRIVATE
        JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 DUBASCO_NO_PLUGIN_ENTRY=1 JUCE_MODAL_LOOPS_PERMITTED=1)
    target_link_libraries(DubascoRenderTest PRIVATE DubascoAssets
        juce::juce_audio_utils juce::juce_dsp juce::juce_recommended_config_flags)
endif()
