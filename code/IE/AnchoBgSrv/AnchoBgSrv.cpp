/****************************************************************************
 * AnchoBgSrv.cpp : Implementation of WinMain
 * Copyright 2012 Salsita software (http://www.salsitasoft.com).
 * Author: Arne Seib <kontakt@seiberspace.de>
 ****************************************************************************/

#include "stdafx.h"
#include "resource.h"
#include "AnchoBgSrvModule.h"

CLSID CLSID_JScript = {0xf414c260,0x6ac0,0x11cf,{0xb6,0xd1,0x00,0xaa,0x00,0xbb,0xbb,0x58}};
CLSID CLSID_JScript9 = {0x16d51579,0xa30b,0x4c8b,{0xa2,0x76,0x0f,0xf4,0xdc,0x41,0xe7,0x55}};

/*============================================================================
 * CAnchoBgSrvModule instance _AtlModule
 */
CAnchoBgSrvModule _AtlModule;

/*============================================================================
 * WinMain
 */
extern "C" int WINAPI _tWinMain(HINSTANCE hInstance, HINSTANCE /*hPrevInstance*/, 
                                LPTSTR /*lpCmdLine*/, int nShowCmd)
{
  _AtlModule.m_hInstance = hInstance;
  HMODULE hInstRich = ::LoadLibrary(CRichEditCtrl::GetLibraryName());
  ATLASSERT(hInstRich != NULL);
  int ret = _AtlModule.WinMain(nShowCmd);
  ::FreeLibrary(hInstRich);
  return ret;
}

